CREATE TABLE IF NOT EXISTS "economic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" text NOT NULL,
	"impact" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
