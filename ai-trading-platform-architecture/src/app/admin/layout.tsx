import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try {
    admin = await requireAdmin("support");
  } catch (err) {
    // Basic fallback: if not authenticated, they shouldn't be here.
    // In a real app we'd redirect to a login page, but since this is private, 
    // maybe we just throw a 404 or redirect to root.
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200" dir="rtl">
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">لوحة تحكم المالك</h1>
        <div className="text-sm text-slate-400">
          مرحباً {admin.name} ({admin.role})
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}