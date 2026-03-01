import { AdminConsole } from "@/components/admin-console";
import {
  getJudgeQueueDiagnosticsForAdmin,
  getCurrentUser,
  listAuditLogsForAdmin,
  listContestsForListView,
  listProblemsForListView,
  listRejudgeRequestsForAdmin,
  listReportsForAdmin,
  listUsers,
} from "@/lib/store";
import { formatDate } from "@/lib/presentation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await getCurrentUser();
  const reports = await listReportsForAdmin();
  const users = listUsers();
  const problems = listProblemsForListView(me.id);
  const contests = listContestsForListView(me.id);
  const audits = await listAuditLogsForAdmin(15);
  const rejudgeRequests = await listRejudgeRequestsForAdmin(20);
  const judgeQueueDiagnostics = await getJudgeQueueDiagnosticsForAdmin();

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">
            通報管理、ユーザー凍結、問題/解説/コンテスト非公開化、再ジャッジ要求履歴を管理します。
          </p>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Audit Logs</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.targetType}:{log.targetId}
                  </td>
                  <td>{log.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AdminConsole
        users={users}
        problems={problems}
        contests={contests}
        reports={reports}
        rejudgeRequests={rejudgeRequests}
        judgeQueueDiagnostics={judgeQueueDiagnostics}
      />
    </div>
  );
}
