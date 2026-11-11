# New-profile random fingerprint

The new-profile dialog gets a `随机指纹` / `Random fingerprint` button above its live fingerprint preview. Clicking it selects a different whole-machine persona from the currently selected OS family, using the catalogue weights. With no current persona, prefer the host OS. Disable it when no compatible alternative exists. Existing profiles retain their current deliberate reseed workflow.

Reset custom CPU, memory, GPU and screen settings when changing the whole machine. Preserve name, project, proxy, status, tags, URLs, notes, timezone, languages, location and advanced settings. The existing preview validates the resulting combination. Creation continues to assign a fresh seed through the existing backend; randomization has no database side effects.

Approach chosen by the implementer: reuse catalogue personas rather than inventing independent UA/GPU combinations or changing backend seed handling. Keep the real-monitor screen default. Only new profiles expose this action. Verify compatible selection, exclusion of the current machine, override preservation, preview updates and draft-field retention; build and update the current local app.
