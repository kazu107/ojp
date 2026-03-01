import { ProfileForm } from "@/components/profile-form";
import { formatDate } from "@/lib/presentation";
import { getCurrentUser } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await getCurrentUser();

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">
            表示名は30日クールダウンと一意制約つきで更新できます。変更履歴は監査ログに記録されます。
          </p>
        </div>
      </section>
      <section className="panel stack">
        <p className="text-soft">Username: {user.username}</p>
        <p className="text-soft">Role: {user.role}</p>
        <p className="text-soft">Status: {user.status}</p>
        <p className="text-soft">Updated: {formatDate(user.updatedAt)}</p>
      </section>
      <section className="panel">
        <ProfileForm user={user} />
      </section>
    </div>
  );
}
