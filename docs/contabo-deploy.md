# Contabo production deployments

The public repository and GitHub Actions are the release authority, not a public deployment endpoint. The VPS checks for a successful `Judge Checks` push run and a successful `Authorize release` job in `Contabo deployment` for the exact current `main` SHA. The VPS uses GitHub's public endpoints. No production credentials, SSH keys or Coolify API secrets are stored in GitHub.

- Push to `main` as usual. `Confirm live origin` in GitHub Actions passes only once a fresh public HTTPS response identifies the exact commit.
- The VPS builds the image without production secrets, verifies Web startup using the rehearsal DB and runs toolchain checks against the candidate isolated worker. A failed build/probe does not change production.
- The worker and Web are switched together, with a brief write gate. Active contests or nonempty queues defer the switch. A failure before reopening public traffic restores the last healthy service and worker.
- Updates to `prisma/` or `prisma.config.ts` require a reviewed manual deployment. The timer never runs a production schema migration.
- Use `journalctl -u ojp-autodeploy -n 100` for deployment status and `/var/lib/ojp-autodeploy/releases/<commit>/` for candidate build and diagnostic logs. The running commit is recorded in `/var/lib/ojp-autodeploy/current-sha`. If the write gate cannot safely be released after a failed rollback, inspect `needs-recovery` and the recorded previous compose, worker and route files before intervening.
- Images and worker filesystems are retained for rollback. Inspect disk space periodically; the timer stops preparing new releases before free disk drops below 18 GB. It does not delete database data or backups.

Stage the reviewed files from `ops/contabo/` on the VPS instead of running a freshly fetched deployment script as root. Updating application source is separate from updating this privileged deployer. Coolify's temporary API access is local to the VPS; the token is created for the installed production service operation and revoked afterward.
