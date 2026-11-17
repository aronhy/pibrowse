// SPDX-License-Identifier: AGPL-3.0-or-later

//! Where an installed extension came from, and the extensions a project gives
//! to every profile in it.
//!
//! Two things were missing from ext.rs, and both are bookkeeping rather than
//! unpacking, which is why they are here and not there.
//!
//! **A source.** An extension in a profile was a directory and nothing else:
//! nothing said whether it came from the Web Store or from a folder on this
//! machine, so there was nothing to ask for a newer version. Updating meant
//! finding the file again and installing it over itself, per profile. With the
//! source written down, "refresh" is one action: the store is asked again,
//! through the profile's own proxy, or the folder is read again.
//!
//! **A project's list.** Asked for on 11.11.2026: profiles are kept in
//! projects, and the profiles of one project should always have the same
//! extensions, including a profile moved into it tomorrow. `install_many`
//! reaches the profiles that exist when it is pressed. A list kept with the
//! project is applied when a profile of that project is launched, so it also
//! reaches the ones made or moved in afterwards -- and takes back what it
//! gave when a profile leaves.
//!
//! # What a project may remove
//!
//! Only what a project put there. `given` names, per profile, the extensions
//! that arrived through a project's list; an extension somebody installed by
//! hand is never in it and is never touched, whichever project the profile is
//! moved to. An extension that was already there when a list first named it
//! stays the profile's own for the same reason: taking away on the way out
//! what the project did not bring on the way in would delete somebody's work.
//!
//! Removing an extension's directory leaves its storage in the profile
//! (`Local Extension Settings/<id>`). That is deliberate: a profile moved out
//! of a project and back should find its wallet signed in, and the id is
//! pinned (ext.rs), so the storage is still that extension's when it returns.
//!
//! Both halves of that are defaults, and both can be turned off (asked for
//! the same day, by the person who asked for the lists): `exclusive` makes a
//! project's list the whole of what its profiles carry, so an extension
//! installed by hand goes at the next launch as well; `wipe_storage` removes
//! an extension's storage with it, so what comes back later comes back signed
//! out. They are one pair of switches for the machine rather than per
//! project, because the moment they matter is a profile changing project, and
//! "whose rule applies, the one it left or the one it joined" has no answer a
//! person would guess. `exclusive` does nothing in a project with no list:
//! an empty list that strips every profile of everything is a mistake nobody
//! asked to be able to make.
//!
//! # An unpacked folder's key
//!
//! ext.rs says why an unpacked extension needs a `key` and what was measured.
//! The key is made once per source folder and kept here, so every profile
//! that takes the folder gets one id, and a refresh keeps it. It stays on this
//! machine with the path it belongs to; the installed copy carries it in its
//! manifest, so a profile sent to a colleague keeps the id without their
//! machine ever knowing the path.
//!
//! # Where this lives
//!
//! One JSON file on this machine, like bookmark sets (bookmarks.rs) and for
//! the same reason: it names profiles and projects by id and local folders by
//! path, none of which mean anything on another computer. A team profile's
//! list of extensions travels as its result, in the bundle.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

/// Most extensions one project may give. A browser with fifty extensions is a
/// fingerprint of its own, and a list that long is a paste gone wrong.
pub const MAX_PER_PROJECT: usize = 50;

/// Where an extension is fetched from when it is installed or refreshed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    /// The Chrome Web Store, by the extension's id.
    Store { id: String },
    /// A folder of unpacked extension on this machine, by absolute path.
    Folder { path: String },
}

/// How a project's list is enforced. Both off unless asked for.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    /// A profile in a project that has a list carries that list and nothing
    /// else: what was installed by hand is removed too.
    #[serde(default)]
    pub exclusive: bool,
    /// Removing an extension removes its storage with it.
    #[serde(default)]
    pub wipe_storage: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct File {
    #[serde(default)]
    options: Options,
    /// Source folder → the key its copies are pinned with, base64.
    #[serde(default)]
    keys: BTreeMap<String, String>,
    /// `<profile id>/<extension id>` → where it was installed from.
    #[serde(default)]
    installed: BTreeMap<String, Source>,
    /// Project id → what every profile in it is given.
    #[serde(default)]
    projects: BTreeMap<String, Vec<Source>>,
    /// Profile id → the extension ids a project put there.
    #[serde(default)]
    given: BTreeMap<String, Vec<String>>,
}

pub struct Book {
    path: PathBuf,
    file: File,
}

impl Book {
    /// A file that does not parse is an empty book, not an error: this is
    /// bookkeeping, and refusing to launch a profile over it would be worse
    /// than forgetting where an extension came from.
    ///
    /// But it is not forgotten by writing over it. The file holds every
    /// folder's key, and a book started empty and written back gave each
    /// folder a new key at its next install: a new id in every profile, and
    /// every one of them signed out (found in review, 11.11.2026). So the
    /// file that could not be read is moved aside, under a name that says
    /// when, for a person to mend and put back.
    pub fn load(path: PathBuf) -> Self {
        let file = match std::fs::read(&path) {
            // Not there yet, which is how every install starts.
            Err(_) => File::default(),
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(file) => file,
                Err(e) => {
                    let aside = corrupt_name(&path);
                    match std::fs::rename(&path, &aside) {
                        Ok(()) => tracing::warn!(
                            error = %e, kept = %aside.display(),
                            "extension-sources.json does not parse; it was moved aside and a new one started"
                        ),
                        Err(moved) => tracing::warn!(
                            error = %e, rename = %moved,
                            "extension-sources.json does not parse and could not be moved aside"
                        ),
                    }
                    File::default()
                }
            },
        };
        Self { path, file }
    }

    pub fn write(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.file)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// The key for a source folder, made the first time it is asked for.
    /// The caller writes the book afterwards.
    pub fn key_for(&mut self, folder: &str) -> Vec<u8> {
        if let Some(key) = self.key_of(folder) {
            return key;
        }
        use rand::RngCore;
        let mut key = vec![0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        self.file.keys.insert(folder.to_string(), base64::engine::general_purpose::STANDARD.encode(&key));
        key
    }

    /// The key a source folder already has, without making one: for a caller
    /// that has to know whether there is anything new to write.
    pub fn key_of(&self, folder: &str) -> Option<Vec<u8>> {
        let b64 = base64::engine::general_purpose::STANDARD;
        self.file.keys.get(folder).and_then(|k| b64.decode(k).ok()).filter(|k| !k.is_empty())
    }

    pub fn record(&mut self, profile: &str, ext: &str, source: Source) {
        self.file.installed.insert(format!("{profile}/{ext}"), source);
    }

    /// The extension has gone from the profile: nothing to refresh, and no
    /// project gave what is not there.
    pub fn forget(&mut self, profile: &str, ext: &str) {
        self.file.installed.remove(&format!("{profile}/{ext}"));
        if let Some(given) = self.file.given.get_mut(profile) {
            given.retain(|id| id != ext);
            if given.is_empty() {
                self.file.given.remove(profile);
            }
        }
    }

    pub fn source_of(&self, profile: &str, ext: &str) -> Option<Source> {
        self.file.installed.get(&format!("{profile}/{ext}")).cloned()
    }

    pub fn project(&self, project: &str) -> Vec<Source> {
        self.file.projects.get(project).cloned().unwrap_or_default()
    }

    /// Replaces a project's list. An empty list removes the entry, so a
    /// project that gives nothing is the same as one never set up.
    ///
    /// An entry the list already has is kept as it is written, without being
    /// looked at again. The interface sends the whole list every time, and
    /// checking all of it meant that one folder on a disk not mounted today
    /// refused every edit except its own removal -- which then uninstalled it
    /// from every profile (found in review, 11.11.2026). Only what is new has
    /// to exist now.
    pub fn set_project(&mut self, project: &str, list: Vec<Source>) -> anyhow::Result<()> {
        if project.trim().is_empty() {
            anyhow::bail!("project_id is required");
        }
        let stored = self.project(project);
        let mut clean: Vec<Source> = Vec::new();
        for source in list {
            let source = match source {
                Source::Store { id } => {
                    let id = id.trim().to_string();
                    if !fury_shared::extensions::is_id(&id) {
                        anyhow::bail!("{id:?} is not an extension id");
                    }
                    Source::Store { id }
                }
                Source::Folder { path } => {
                    let as_stored = Source::Folder { path: path.trim().to_string() };
                    if stored.contains(&as_stored) {
                        as_stored
                    } else {
                        Source::Folder { path: canonical_folder(&path)? }
                    }
                }
            };
            if !clean.contains(&source) {
                clean.push(source);
            }
        }
        if clean.len() > MAX_PER_PROJECT {
            anyhow::bail!("a project gives at most {MAX_PER_PROJECT} extensions");
        }
        if clean.is_empty() {
            self.file.projects.remove(project);
        } else {
            self.file.projects.insert(project.to_string(), clean);
        }
        Ok(())
    }

    pub fn options(&self) -> Options {
        self.file.options
    }

    pub fn set_options(&mut self, options: Options) {
        self.file.options = options;
    }

    pub fn given(&self, profile: &str) -> Vec<String> {
        self.file.given.get(profile).cloned().unwrap_or_default()
    }

    pub fn set_given(&mut self, profile: &str, ids: Vec<String>) {
        if ids.is_empty() {
            self.file.given.remove(profile);
        } else {
            self.file.given.insert(profile.to_string(), ids);
        }
    }
}

/// A folder as it is written down: absolute, existing, with links resolved, so
/// one folder reached by two spellings is one source with one key.
pub fn canonical_folder(path: &str) -> anyhow::Result<String> {
    let path = path.trim();
    if path.is_empty() {
        anyhow::bail!("path is required");
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        anyhow::bail!("{path:?} is not an absolute path; the agent has no folder of its own for it to be relative to");
    }
    let real = std::fs::canonicalize(p).map_err(|e| anyhow::anyhow!("{path}: {e}"))?;
    if !real.is_dir() {
        anyhow::bail!("{path} is not a folder");
    }
    Ok(real.to_string_lossy().to_string())
}

/// Where a book that does not parse is put: beside the real one, so whoever
/// looks for it finds it, and dated, so a second bad day does not overwrite
/// the first.
fn corrupt_name(path: &Path) -> PathBuf {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{stem}.corrupt-{secs}.json"))
}

/// What applying a project's list to one profile comes to.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// Wanted and not there: to be installed, and `given` if that succeeds.
    pub install: Vec<(String, Source)>,
    /// Given by a project earlier and not wanted by the one it is in now.
    pub remove: Vec<String>,
    /// Given earlier, still wanted, still there.
    pub keep: Vec<String>,
}

/// `wanted` is the project's list with each entry's extension id; `installed`
/// is what the profile's directory holds; `given` is what a project put there.
/// `exclusive`: everything installed and not wanted goes, whoever put it
/// there. What is `keep` does not widen with it -- an extension somebody
/// installed stays theirs on record, so switching `exclusive` off again does
/// not leave the project owning what it never gave.
pub fn plan(wanted: &[(String, Source)], installed: &[String], given: &[String], exclusive: bool) -> Plan {
    let is_wanted = |id: &String| wanted.iter().any(|(w, _)| w == id);
    let mut out = Plan::default();
    for (id, source) in wanted {
        if !installed.contains(id) && !out.install.iter().any(|(i, _)| i == id) {
            out.install.push((id.clone(), source.clone()));
        }
    }
    for id in given {
        if !installed.contains(id) {
            // Removed by hand since: no longer anybody's to take back. If the
            // project still wants it, `install` above brings it again.
            continue;
        }
        if is_wanted(id) {
            out.keep.push(id.clone());
        } else {
            out.remove.push(id.clone());
        }
    }
    if exclusive {
        for id in installed {
            if !is_wanted(id) && !out.remove.contains(id) {
                out.remove.push(id.clone());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tmp::TempDir;

    fn store(id: &str) -> Source {
        Source::Store { id: id.to_string() }
    }
    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const C: &str = "cccccccccccccccccccccccccccccccc";

    /// The four cases of one profile meeting one list, and the one the whole
    /// design turns on: what a person installed is in neither `remove` nor
    /// `keep`, whatever the project wants.
    #[test]
    fn a_project_installs_what_is_missing_and_removes_only_what_it_gave() {
        let wanted = vec![(A.to_string(), store(A)), (B.to_string(), store(B))];
        let s = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        // A new profile: both arrive.
        let p = plan(&wanted, &[], &[], false);
        assert_eq!(p.install.iter().map(|(i, _)| i.as_str()).collect::<Vec<_>>(), [A, B]);
        assert!(p.remove.is_empty() && p.keep.is_empty());

        // Launched again: nothing to do, and both are still the project's.
        let p = plan(&wanted, &s(&[A, B]), &s(&[A, B]), false);
        assert!(p.install.is_empty() && p.remove.is_empty());
        assert_eq!(p.keep, s(&[A, B]));

        // Moved to a project that wants only B, with C installed by hand:
        // A goes, B stays, C is not mentioned at all.
        let only_b = vec![(B.to_string(), store(B))];
        let p = plan(&only_b, &s(&[A, B, C]), &s(&[A, B]), false);
        assert_eq!(p.remove, s(&[A]));
        assert_eq!(p.keep, s(&[B]));
        assert!(p.install.is_empty());

        // A was there before any project named it: it is the profile's own,
        // and leaving the project does not take it.
        let p = plan(&[], &s(&[A]), &[], false);
        assert_eq!(p, Plan::default());

        // Given, then removed by hand: brought back while still wanted, and
        // not "removed" a second time once it is not.
        let p = plan(&wanted, &s(&[B]), &s(&[A, B]), false);
        assert_eq!(p.install.iter().map(|(i, _)| i.as_str()).collect::<Vec<_>>(), [A]);
        let p = plan(&[], &s(&[B]), &s(&[A, B]), false);
        assert_eq!(p.remove, s(&[B]));
    }

    /// With `exclusive`, what was installed by hand goes as well, and it does
    /// not become the project's on record by having been left alone before.
    #[test]
    fn an_exclusive_list_removes_what_it_did_not_give_too() {
        let s = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let only_b = vec![(B.to_string(), store(B))];
        let p = plan(&only_b, &s(&[A, B, C]), &s(&[A]), true);
        assert_eq!(p.remove, s(&[A, C]));
        assert!(p.keep.is_empty(), "B was there by hand and stays by hand: {p:?}");
        assert!(p.install.is_empty());
        // Off, the same profile loses only what a project gave.
        assert_eq!(plan(&only_b, &s(&[A, B, C]), &s(&[A]), false).remove, s(&[A]));
    }

    #[test]
    fn the_book_survives_a_round_trip_and_a_file_that_is_not_json() {
        let tmp = TempDir::new("fury-extsets");
        let path = tmp.join("extension-sources.json");
        let folder = tmp.join("my ext");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = canonical_folder(folder.to_str().unwrap()).unwrap();

        let mut book = Book::load(path.clone());
        let key = book.key_for(&folder);
        assert_eq!(key.len(), 32);
        assert_eq!(book.key_for(&folder), key, "one folder, one key");
        book.record("p1", A, store(A));
        book.record("p1", B, Source::Folder { path: folder.clone() });
        book.set_project("proj", vec![store(A), store(A), Source::Folder { path: folder.clone() }]).unwrap();
        book.set_given("p1", vec![A.to_string(), B.to_string()]);
        assert_eq!(book.options(), Options::default(), "both switches are off until somebody turns one on");
        book.set_options(Options { exclusive: true, wipe_storage: false });
        book.write().unwrap();

        let mut book = Book::load(path.clone());
        assert_eq!(book.key_for(&folder), key, "the key is the same after a restart");
        assert_eq!(book.source_of("p1", A), Some(store(A)));
        assert_eq!(book.options(), Options { exclusive: true, wipe_storage: false });
        assert_eq!(book.project("proj").len(), 2, "the same source twice is one entry");
        assert_eq!(book.project("nobody"), Vec::new());

        book.forget("p1", A);
        assert_eq!(book.source_of("p1", A), None);
        assert_eq!(book.given("p1"), [B.to_string()], "what is gone is nobody's gift");
        book.set_project("proj", Vec::new()).unwrap();
        assert!(book.project("proj").is_empty());

        std::fs::write(&path, b"{ not json").unwrap();
        let book = Book::load(path);
        assert!(book.project("proj").is_empty() && book.given("p1").is_empty());
    }

    /// The book that does not parse is started again, and the file is still
    /// there under another name: writing the new one must not be what loses
    /// every folder's key.
    #[test]
    fn a_book_that_does_not_parse_is_moved_aside_and_not_written_over() {
        let tmp = TempDir::new("fury-extsets-corrupt");
        let path = tmp.join("extension-sources.json");
        let damaged = br#"{ "keys": { "/src/ext": "c29tZSBrZXk=" }, "installed": { tru"#;
        std::fs::write(&path, damaged).unwrap();

        let mut book = Book::load(path.clone());
        assert!(!path.exists(), "the damaged file is still where the next write goes");
        book.record("p1", A, store(A));
        book.write().unwrap();

        let kept: Vec<PathBuf> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().unwrap().to_string_lossy().contains("corrupt"))
            .collect();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert_eq!(std::fs::read(&kept[0]).unwrap(), damaged, "what was moved aside is what was there");
        assert!(kept[0].file_name().unwrap().to_string_lossy().starts_with("extension-sources.corrupt-"));
        assert_eq!(Book::load(path).source_of("p1", A), Some(store(A)));
    }

    /// A folder already in the list stays in it when it cannot be read, so the
    /// rest of the list can still be edited; a new one still has to exist.
    #[test]
    fn an_entry_already_in_the_list_is_not_checked_again() {
        let tmp = TempDir::new("fury-extsets-unmounted");
        let mut book = Book::load(tmp.join("x.json"));
        let disk = tmp.join("disk");
        std::fs::create_dir_all(&disk).unwrap();
        let disk = canonical_folder(disk.to_str().unwrap()).unwrap();
        let on_disk = Source::Folder { path: disk.clone() };
        book.set_project("proj", vec![on_disk.clone(), store(A)]).unwrap();

        std::fs::remove_dir_all(&disk).unwrap();
        book.set_project("proj", vec![on_disk.clone(), store(A), store(B)]).unwrap();
        assert_eq!(book.project("proj"), vec![on_disk.clone(), store(A), store(B)]);
        book.set_project("proj", vec![on_disk.clone(), store(B)]).unwrap();
        assert_eq!(book.project("proj"), vec![on_disk.clone(), store(B)]);

        // Another project never had it, and a folder that is not there is
        // still not something to start giving.
        assert!(book.set_project("other", vec![on_disk.clone()]).is_err());
        let missing = Source::Folder { path: tmp.join("nowhere").to_string_lossy().into() };
        assert!(book.set_project("proj", vec![on_disk, missing]).is_err());
        assert_eq!(book.project("proj").len(), 2, "a refused list changes nothing");
    }

    #[test]
    fn a_list_is_checked_before_it_is_kept() {
        let tmp = TempDir::new("fury-extsets-bad");
        let mut book = Book::load(tmp.join("x.json"));
        assert!(book.set_project("proj", vec![store("not-an-id")]).is_err());
        assert!(book.set_project("proj", vec![Source::Folder { path: "relative/dir".into() }]).is_err());
        let missing = tmp.join("nowhere");
        assert!(book.set_project("proj", vec![Source::Folder { path: missing.to_string_lossy().into() }]).is_err());
        assert!(book.set_project("  ", vec![store(A)]).is_err());
        assert!(book.project("proj").is_empty(), "a refused list changes nothing");
    }
}
