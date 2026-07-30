// ---------------------------------------------------------------------------
// Lightweight ML Layer — Signal Quality Predictor (v3.2)
//
// Uses a simplified Gradient Boosting approach on `signal_outcomes` data.
// The model learns from historical trades: which features predict wins?
//
// This is deliberately LIGHTWEIGHT:
//   - No external ML libraries (no TensorFlow, no sklearn)
//   - Simplified decision-tree ensemble trained on-demand
//   - Features are ENGINE outputs (confluence, regime, reason codes, ATR)
//   - Output: probability multiplier applied before risk evaluation
//
// The model is PURE: it receives features as input and returns a score.
// Training data is loaded from the DB by the caller.
// ---------------------------------------------------------------------------

export type MLFeatures = {
  confluence: number;
  regimeTrend: number;        // -1 to 1 (trend analyser score)
  regimeStructure: number;
  regimeZones: number;
  atrPct: number;
  volatilityExpansion: number;
  mtfAlignment: number;       // 0-1
  hasDivergence: boolean;
  hasVolumeConfirmation: boolean;
  isReversal: boolean;
  isBreakout: boolean;
  positionCount: number;
  correlationOverlap: number;
  hourOfDay: number;
  dayOfWeek: number;
};

export type MLTrainingRow = MLFeatures & {
  won: boolean;
  rMultiple: number;
};

export type MLPrediction = {
  /** Probability of winning (0-1). */
  winProbability: number;
  /** Expected R-multiple. */
  expectedR: number;
  /** Confidence in this prediction (based on similarity to training data). */
  confidence: number;
  /** Whether enough training data exists for a reliable prediction. */
  reliable: boolean;
};

// ---------------------------------------------------------------------------
// Decision Tree ensemble (simplified Gradient Boosting)
// ---------------------------------------------------------------------------

type TreeNode = {
  feature: keyof MLFeatures;
  threshold: number;
  left: TreeNode | null;
  right: TreeNode | null;
  prediction: number | null; // leaf only
};

type DecisionTree = {
  root: TreeNode;
  featureImportance: Map<string, number>;
};

/**
 * Trains a single decision tree on the provided data.
 * Max depth is limited to prevent overfitting with small datasets.
 */
function trainTree(data: MLTrainingRow[], depth: number = 0, maxDepth: number = 4): TreeNode {
  // Stop conditions
  if (data.length < 5 || depth >= maxDepth) {
    const wins = data.filter(r => r.won).length;
    return { feature: "confluence", threshold: 0, left: null, right: null, prediction: data.length > 0 ? wins / data.length : 0.5 };
  }

  // All same class
  const allWon = data.every(r => r.won);
  const allLost = data.every(r => !r.won);
  if (allWon) return { feature: "confluence", threshold: 0, left: null, right: null, prediction: 1 };
  if (allLost) return { feature: "confluence", threshold: 0, left: null, right: null, prediction: 0 };

  // Find best split
  const features: (keyof MLFeatures)[] = [
    "confluence", "regimeTrend", "atrPct", "mtfAlignment",
    "volatilityExpansion", "correlationOverlap", "positionCount",
  ];

  let bestGain = -1;
  let bestFeature: keyof MLFeatures = "confluence";
  let bestThreshold = 0;

  for (const feature of features) {
    const values = data.map(r => r[feature] as number).sort((a, b) => a - b);
    // Try splits at each unique value
    for (let i = 1; i < values.length; i++) {
      const threshold = (values[i - 1] + values[i]) / 2;
      const gain = informationGain(data, feature, threshold);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = feature;
        bestThreshold = threshold;
      }
    }
  }

  if (bestGain <= 0.01) {
    const wins = data.filter(r => r.won).length;
    return { feature: "confluence", threshold: 0, left: null, right: null, prediction: data.length > 0 ? wins / data.length : 0.5 };
  }

  const left = data.filter(r => (r[bestFeature] as number) <= bestThreshold);
  const right = data.filter(r => (r[bestFeature] as number) > bestThreshold);

  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: trainTree(left, depth + 1, maxDepth),
    right: trainTree(right, depth + 1, maxDepth),
    prediction: null,
  };
}

function entropy(data: MLTrainingRow[]): number {
  if (data.length === 0) return 0;
  const p = data.filter(r => r.won).length / data.length;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

function informationGain(data: MLTrainingRow[], feature: keyof MLFeatures, threshold: number): number {
  const left = data.filter(r => (r[feature] as number) <= threshold);
  const right = data.filter(r => (r[feature] as number) > threshold);
  if (left.length === 0 || right.length === 0) return 0;

  const totalEntropy = entropy(data);
  const weightedEntropy = (left.length / data.length) * entropy(left) + (right.length / data.length) * entropy(right);
  return totalEntropy - weightedEntropy;
}

function predictTree(node: TreeNode, features: MLFeatures): number {
  if (node.prediction !== null) return node.prediction;
  const value = features[node.feature] as number;
  if (value <= node.threshold && node.left) return predictTree(node.left, features);
  if (node.right) return predictTree(node.right, features);
  return 0.5;
}

// ---------------------------------------------------------------------------
// Ensemble
// ---------------------------------------------------------------------------

const MIN_TRAINING_ROWS = 25;

export class MLPredictor {
  private trees: DecisionTree[] = [];
  private trained = false;
  private trainingSize = 0;

  /**
   * Trains an ensemble of 5 trees on bootstrapped samples.
   * Each tree sees a random subset of the data (bagging).
   */
  train(data: MLTrainingRow[]): void {
    if (data.length < MIN_TRAINING_ROWS) {
      this.trained = false;
      this.trainingSize = data.length;
      return;
    }

    this.trees = [];
    this.trainingSize = data.length;

    // Train 5 trees on bootstrapped samples
    for (let i = 0; i < 5; i++) {
      const sample = bootstrapSample(data);
      const root = trainTree(sample, 0, 4);
      this.trees.push({ root, featureImportance: new Map() });
    }

    this.trained = true;
  }

  /**
   * Predicts win probability and expected R for a new trade.
   */
  predict(features: MLFeatures): MLPrediction {
    if (!this.trained || this.trees.length === 0) {
      return {
        winProbability: 0.5,
        expectedR: 0,
        confidence: 0,
        reliable: false,
      };
    }

    // Ensemble prediction: average of all trees
    const predictions = this.trees.map(t => predictTree(t.root, features));
    const avgPred = predictions.reduce((a, b) => a + b, 0) / predictions.length;

    // Variance of predictions = confidence
    const variance = predictions.reduce((s, p) => s + (p - avgPred) ** 2, 0) / predictions.length;
    const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 2));

    // Expected R: scale by win probability
    // Conservative: assume avg win = 1R, avg loss = -1R
    const expectedR = avgPred * 1.0 - (1 - avgPred) * 1.0;

    return {
      winProbability: Math.round(avgPred * 1000) / 1000,
      expectedR: Math.round(expectedR * 1000) / 1000,
      confidence: Math.round(confidence * 100) / 100,
      reliable: this.trainingSize >= MIN_TRAINING_ROWS,
    };
  }

  isReady(): boolean {
    return this.trained && this.trainingSize >= MIN_TRAINING_ROWS;
  }

  getSampleSize(): number {
    return this.trainingSize;
  }
}

function bootstrapSample<T>(data: T[]): T[] {
  const sample: T[] = [];
  for (let i = 0; i < data.length; i++) {
    const idx = Math.floor(Math.random() * data.length);
    sample.push(data[idx]);
  }
  return sample;
}

/**
 * Extracts ML features from a trade context.
 * Pure function — no DB, no I/O.
 */
export function extractFeatures(params: {
  confluence: number;
  regime: string;
  trendScore: number;
  structureScore: number;
  zonesScore: number;
  atrPct: number;
  volExpansion: number;
  mtfAlignment: number;
  hasDivergence: boolean;
  volConfirmed: boolean;
  isReversal: boolean;
  isBreakout: boolean;
  openPositions: number;
  correlationOverlap: number;
  now?: Date;
}): MLFeatures {
  const now = params.now ?? new Date();
  return {
    confluence: params.confluence,
    regimeTrend: params.trendScore,
    regimeStructure: params.structureScore,
    regimeZones: params.zonesScore,
    atrPct: params.atrPct,
    volatilityExpansion: params.volExpansion,
    mtfAlignment: params.mtfAlignment,
    hasDivergence: params.hasDivergence,
    hasVolumeConfirmation: params.volConfirmed,
    isReversal: params.isReversal,
    isBreakout: params.isBreakout,
    positionCount: params.openPositions,
    correlationOverlap: params.correlationOverlap,
    hourOfDay: now.getUTCHours(),
    dayOfWeek: now.getUTCDay(),
  };
}

/** Singleton */
let _predictor: MLPredictor | null = null;

export function getMLPredictor(): MLPredictor {
  if (!_predictor) _predictor = new MLPredictor();
  return _predictor;
}

export function resetMLPredictor(): void {
  _predictor = null;
}
