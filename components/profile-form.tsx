"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@/lib/types";

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const trimmedDisplayName = displayName.trim();
  const trimmedBio = bio.trim();
  const hasChanges = trimmedDisplayName !== user.displayName || trimmedBio !== user.bio.trim();

  const nextDisplayNameChangeAt = user.displayNameChangedAt
    ? new Date(new Date(user.displayNameChangedAt).getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;
  const canChangeDisplayName =
    !nextDisplayNameChangeAt || nextDisplayNameChangeAt.getTime() <= Date.now();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges) {
      setSuccess("No changes to save.");
      setError("");
      return;
    }
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmedDisplayName,
          bio,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "profile update failed");
      }
      setSuccess("Profile updated.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "unexpected error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="field-label">Display Name</span>
        <input
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        <span className="field-help">
          Public name shown on submissions and rankings. It can be changed once every 30 days.
          {!canChangeDisplayName && nextDisplayNameChangeAt
            ? ` Next change: ${nextDisplayNameChangeAt.toLocaleString()}.`
            : ""}
        </span>
      </label>
      <label className="field">
        <span className="field-label">Bio</span>
        <textarea className="textarea" value={bio} onChange={(event) => setBio(event.target.value)} />
        <span className="field-help">Profile text shown on your user page.</span>
      </label>
      {error ? <p className="badge badge-red">{error}</p> : null}
      {success ? <p className="badge badge-green">{success}</p> : null}
      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving || !trimmedDisplayName}>
          {isSaving ? "Saving..." : "Save Profile"}
        </button>
      </div>
    </form>
  );
}
