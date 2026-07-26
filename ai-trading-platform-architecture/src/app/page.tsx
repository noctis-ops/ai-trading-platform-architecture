// ---------------------------------------------------------------------------
// Root page — deliberately NOT a marketing site.
//
// This product is sold privately and delivered through Telegram. The web
// surface exists only for the owner console. Exposing a public signup page
// would contradict the access model (see /docs/PRODUCT.md), so the root simply
// points a human at the bot and reveals nothing about the system's internals.
// ---------------------------------------------------------------------------
export const dynamic = "force-static";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-100">خدمة خاصة للمشتركين</h1>
        <p className="mt-4 text-sm leading-7 text-slate-400">
          هذه الخدمة تعمل عبر بوت تيليجرام ومتاحة للمشتركين فقط.
          <br />
          للاستفسار أو الاشتراك، تواصل عبر القناة الرسمية.
        </p>
        <p className="mt-8 text-xs text-slate-600">التحليلات المقدمة لأغراض معلوماتية ولا تشكل نصيحة استثمارية.</p>
      </div>
    </main>
  );
}
