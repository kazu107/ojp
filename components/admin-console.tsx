"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Contest, Problem, RejudgeRequest, Report, User } from "@/lib/types";
import { formatDate } from "@/lib/presentation";

interface AdminConsoleProps {
  users: User[];
  problems: Problem[];
  contests: Contest[];
  reports: Report[];
  rejudgeRequests: RejudgeRequest[];
}

export function AdminConsole({
  users,
  problems,
  contests,
  reports,
  rejudgeRequests,
}: AdminConsoleProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  async function postJson(url: string, payload: Record<string, string>) {
    setError("");
    setBusyKey(url);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "request failed");
      }
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "unexpected error");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="stack">
      {error ? <p className="badge badge-red">{error}</p> : null}

      <section className="panel stack">
        <h2 className="panel-title">Reports</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.id}</td>
                  <td>
                    {report.targetType}:{report.targetId}
                  </td>
                  <td>{report.reason}</td>
                  <td>{report.status}</td>
                  <td>
                    <div className="button-row">
                      <button
                        className="button"
                        disabled={busyKey.includes(report.id)}
                        onClick={() =>
                          postJson(`/api/admin/reports/${report.id}/status`, {
                            status: "investigating",
                            reason: "triaging report",
                          })
                        }
                      >
                        Investigate
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={busyKey.includes(report.id)}
                        onClick={() =>
                          postJson(`/api/admin/reports/${report.id}/status`, {
                            status: "resolved",
                            reason: "resolved by admin",
                          })
                        }
                      >
                        Resolve
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Users</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{user.role}</td>
                  <td>{user.status}</td>
                  <td>
                    {user.role === "admin" ? (
                      "-"
                    ) : (
                      <button
                        className="button button-danger"
                        disabled={busyKey.includes(user.id)}
                        onClick={() =>
                          postJson(`/api/admin/users/${user.id}/freeze`, {
                            reason: "manual moderation",
                          })
                        }
                      >
                        Freeze
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Hide Problem</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Visibility</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr key={problem.id}>
                    <td>{problem.id}</td>
                    <td>{problem.title}</td>
                    <td>{problem.visibility}</td>
                    <td>
                      <button
                        className="button button-danger"
                        disabled={busyKey.includes(problem.id)}
                        onClick={() =>
                          postJson(`/api/admin/problems/${problem.id}/hide`, {
                            reason: "admin hide operation",
                          })
                        }
                      >
                        Hide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel stack">
          <h2 className="panel-title">Hide Contest</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Visibility</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((contest) => (
                  <tr key={contest.id}>
                    <td>{contest.id}</td>
                    <td>{contest.title}</td>
                    <td>{contest.visibility}</td>
                    <td>
                      <button
                        className="button button-danger"
                        disabled={busyKey.includes(contest.id)}
                        onClick={() =>
                          postJson(`/api/admin/contests/${contest.id}/hide`, {
                            reason: "admin hide operation",
                          })
                        }
                      >
                        Hide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Rejudge Requests</h2>
        {rejudgeRequests.length === 0 ? (
          <p className="empty">No rejudge requests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Submission</th>
                  <th>Problem</th>
                  <th>Reason</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rejudgeRequests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.id}</td>
                    <td>{request.submissionId}</td>
                    <td>{request.problemId}</td>
                    <td>{request.reason}</td>
                    <td>{formatDate(request.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
