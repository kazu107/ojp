"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Announcement,
  Contest,
  Problem,
  RejudgeRequest,
  Report,
  User,
  UserRole,
} from "@/lib/types";
import { formatDate } from "@/lib/presentation";

interface AdminConsoleProps {
  users: User[];
  problems: Problem[];
  contests: Contest[];
  announcements: Announcement[];
  reports: Report[];
  rejudgeRequests: RejudgeRequest[];
  judgeQueueDiagnostics: {
    stats: {
      queuedJobs: number;
      waitingSubmissions: number;
      running: boolean;
    };
    jobs: Array<{
      id: string;
      submissionId: string;
      queuedAt: string;
      reason: "normal" | "rejudge";
      requestedAt: string;
    }>;
    orphanWaitingSubmissionIds: string[];
  };
}

export function AdminConsole({
  users,
  problems,
  contests,
  announcements,
  reports,
  rejudgeRequests,
  judgeQueueDiagnostics,
}: AdminConsoleProps) {
  const ASSIGNABLE_ROLES: UserRole[] = ["user", "problem_author", "contest_organizer"];
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [roleDraftByUserId, setRoleDraftByUserId] = useState<Record<string, UserRole>>({});
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");

  async function postJson(url: string, payload: Record<string, string>): Promise<boolean> {
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
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "unexpected error");
      return false;
    } finally {
      setBusyKey("");
    }
  }

  async function confirmAndPost(
    message: string,
    url: string,
    payload: Record<string, string>,
  ): Promise<void> {
    if (!window.confirm(message)) {
      return;
    }
    await postJson(url, payload);
  }

  return (
    <div className="stack">
      {error ? <p className="badge badge-red">{error}</p> : null}

      <section className="panel stack">
        <h2 className="panel-title">Announcements</h2>
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!announcementTitle.trim()) {
              setError("announcement title is required");
              return;
            }
            const ok = await postJson("/api/admin/announcements", {
              title: announcementTitle,
              body: announcementBody,
              reason: "admin announcement",
            });
            if (ok) {
              setAnnouncementTitle("");
              setAnnouncementBody("");
            }
          }}
        >
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="input"
              value={announcementTitle}
              onChange={(event) => setAnnouncementTitle(event.target.value)}
              placeholder="Maintenance notice"
            />
          </label>
          <label className="field">
            <span className="field-label">Body</span>
            <textarea
              className="textarea"
              value={announcementBody}
              onChange={(event) => setAnnouncementBody(event.target.value)}
              placeholder="Service update details..."
            />
          </label>
          <div className="button-row">
            <button className="button" type="submit" disabled={busyKey === "/api/admin/announcements"}>
              Post Announcement
            </button>
          </div>
        </form>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Created</th>
                <th>Hidden</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {announcements.length === 0 ? (
                <tr>
                  <td colSpan={5}>No announcements.</td>
                </tr>
              ) : (
                announcements.map((announcement) => (
                  <tr key={announcement.id}>
                    <td>{announcement.id}</td>
                    <td>{announcement.title}</td>
                    <td>{formatDate(announcement.createdAt)}</td>
                    <td>{announcement.isHidden ? "yes" : "no"}</td>
                    <td>
                      <button
                        className="button button-secondary"
                        disabled={busyKey.includes(announcement.id) || announcement.isHidden}
                        onClick={() =>
                          postJson(`/api/admin/announcements/${announcement.id}/hide`, {
                            reason: "admin hide announcement",
                          })
                        }
                      >
                        Hide
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Judge Queue</h2>
        <p className="text-soft">Queued jobs: {judgeQueueDiagnostics.stats.queuedJobs}</p>
        <p className="text-soft">
          Waiting submissions: {judgeQueueDiagnostics.stats.waitingSubmissions}
        </p>
        <p className="text-soft">
          Worker running: {judgeQueueDiagnostics.stats.running ? "yes" : "no"}
        </p>
        <p className="text-soft">
          Orphan waiting submissions: {judgeQueueDiagnostics.orphanWaitingSubmissionIds.length}
        </p>
        <div className="button-row">
          <button
            className="button"
            disabled={busyKey === "/api/admin/judge/queue"}
            onClick={() =>
              postJson("/api/admin/judge/queue", {
                reason: "manual queue repair",
              })
            }
          >
            Repair Queue
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Submission</th>
                <th>Reason</th>
                <th>Requested</th>
                <th>Queued</th>
              </tr>
            </thead>
            <tbody>
              {judgeQueueDiagnostics.jobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>No queued jobs.</td>
                </tr>
              ) : (
                judgeQueueDiagnostics.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.submissionId}</td>
                    <td>{job.reason}</td>
                    <td>{formatDate(job.requestedAt)}</td>
                    <td>{formatDate(job.queuedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {judgeQueueDiagnostics.orphanWaitingSubmissionIds.length > 0 ? (
          <div className="stack">
            <p className="field-label">Orphan Waiting Submission IDs</p>
            {judgeQueueDiagnostics.orphanWaitingSubmissionIds.map((submissionId) => (
              <p key={submissionId} className="text-soft">
                - {submissionId}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Object Storage Migration</h2>
        <p className="text-soft">
          Embedded problem packages can be reconstructed as ZIP and uploaded to R2.
        </p>
        <div className="button-row">
          <button
            className="button"
            disabled={busyKey === "/api/admin/storage/problem-packages/migrate"}
            onClick={() =>
              postJson("/api/admin/storage/problem-packages/migrate", {
                reason: "admin package migration",
              })
            }
          >
            Migrate Problem ZIPs to R2
          </button>
        </div>
      </section>

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
                      <div className="stack">
                        <div className="button-row">
                          {user.status === "frozen" ? (
                            <button
                              className="button button-secondary"
                              disabled={busyKey.includes(user.id)}
                              onClick={() =>
                                postJson(`/api/admin/users/${user.id}/unfreeze`, {
                                  reason: "manual moderation release",
                                })
                              }
                            >
                              Unfreeze
                            </button>
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
                        </div>
                        <div className="button-row">
                          <select
                            className="select"
                            value={roleDraftByUserId[user.id] ?? user.role}
                            onChange={(event) =>
                              setRoleDraftByUserId((prev) => ({
                                ...prev,
                                [user.id]: event.target.value as UserRole,
                              }))
                            }
                          >
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button
                            className="button"
                            disabled={busyKey.includes(user.id)}
                            onClick={() =>
                              postJson(`/api/admin/users/${user.id}/role`, {
                                role: roleDraftByUserId[user.id] ?? user.role,
                                reason: "manual role update",
                              })
                            }
                          >
                            Update Role
                          </button>
                        </div>
                      </div>
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
          <h2 className="panel-title">Problem Controls</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Visibility</th>
                  <th>Explanation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr key={problem.id}>
                    <td>{problem.id}</td>
                    <td>{problem.title}</td>
                    <td>{problem.visibility}</td>
                    <td>{problem.explanationVisibility}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button button-danger"
                          disabled={busyKey.includes(problem.id)}
                          onClick={() =>
                            postJson(`/api/admin/problems/${problem.id}/hide`, {
                              reason: "admin hide operation",
                            })
                          }
                        >
                          Hide Problem
                        </button>
                        <button
                          className="button button-danger"
                          disabled={busyKey.includes(problem.id)}
                          onClick={() =>
                            void confirmAndPost(
                              `Delete problem ${problem.title}? Related submissions and reports will also be removed.`,
                              `/api/admin/problems/${problem.id}/delete`,
                              {
                                reason: "admin delete operation",
                              },
                            )
                          }
                        >
                          Delete Problem
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={busyKey.includes(problem.id)}
                          onClick={() =>
                            postJson(`/api/admin/problems/${problem.id}/explanation/hide`, {
                              reason: "admin explanation hide operation",
                            })
                          }
                        >
                          Hide Explanation
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel stack">
          <h2 className="panel-title">Contest Controls</h2>
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
                      <div className="button-row">
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
                        <button
                          className="button button-danger"
                          disabled={busyKey.includes(contest.id)}
                          onClick={() =>
                            void confirmAndPost(
                              `Delete contest ${contest.title}? Contest reports will be removed and contest submissions will be detached from the contest.`,
                              `/api/admin/contests/${contest.id}/delete`,
                              {
                                reason: "admin delete operation",
                              },
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
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
