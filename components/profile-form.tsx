"use client";
import { useI18n } from "@/components/i18n-provider";


import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@/lib/types";
import { formatDate } from "@/lib/presentation";

export function ProfileForm({ user }: { user: User }) {
  const { t, locale } = useI18n();
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
        <span className="field-label">{t("Display Name")}</span>
        <input
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
        />
        <span className="field-help">
          {t("Public name shown on submissions and rankings. It can be changed once every 30 days.")}{!canChangeDisplayName && nextDisplayNameChangeAt ? t(" Next change: {value0}.", { value0: formatDate(nextDisplayNameChangeAt.toISOString(), locale) }) : ""}
        </span>
      </label>
      <label className="field">
        <span className="field-label">{t("Bio")}</span>
        <textarea className="textarea" value={bio} onChange={(event) => setBio(event.target.value)} />
        <span className="field-help">{t("Profile text shown on your user page.")}</span>
      </label>
      {error ? <p className="badge badge-red">{t(error)}</p> : null}
      {success ? <p className="badge badge-green">{t(success)}</p> : null}
      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving || !trimmedDisplayName}>
          {isSaving ? t("Saving...") : t("Save Profile")}
        </button>
      </div>
    </form>
  );
}
