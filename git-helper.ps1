<#
.SYNOPSIS
    Git Helper - A user-friendly PowerShell script for common Git operations.

.DESCRIPTION
    Run without arguments for an interactive menu, or pass commands directly for quick execution.
    Manages both the public repo and the private config repo (.private-git/).

    Usage:
        git-helper                          # Interactive menu
        git-helper {command} [args]         # Direct execution
        git-helper help                     # Show all commands
        git-helper help {command}           # Show help for specific command

.EXAMPLE
    git-helper release v1.2.0 "Bug fixes"
    git-helper sync
    git-helper private sync
    git-helper private save "Updated cursor rules"
    git-helper syncall

.NOTES
    Author: Max Soukhomlinov
    Version: 2.5.1

    Changelog:
    2.5.1 - fix: Invoke-Release now pushes only the newly created tag instead of --tags (all tags).
            Previously, stale local tags that had diverged from remote caused 'already exists'
            rejections, which made git push exit non-zero and report the release as failed even
            though the branch and new tag were pushed successfully.
    2.5.0 - feat: Added force-push and force-pull commands for both public and private repos.
            force-push: forces local changes to override remote (git push --force-with-lease).
            force-pull: forces remote changes to override local (git fetch + reset --hard).
            Both require explicit confirmation due to destructive nature.
            CLI: git-helper force-push, git-helper force-pull
            CLI: git-helper private force-push, git-helper private force-pull
            Menu: items 22-25 added for all four force operations.
    2.4.0 - feat: Invoke-Push and Invoke-Release now auto-push private repo when the public
            push succeeds. Previously private config changes were silently left behind on the
            remote unless the user remembered to run 'git-helper private push' separately.
            Private push is best-effort: if .private-git is not set up or has nothing to push,
            it is silently skipped. Failures show a warning but do not fail the overall command.
            feat: Invoke-SyncAll is now bidirectional -pulls then pushes for both public and
            private repos. Auto-commits uncommitted private changes before pushing. Previously
            syncall only pulled, leaving unpushed commits behind.
            feat: Show-Menu now displays yellow warnings when there are uncommitted changes or
            unpushed commits in either repo, so pending work is immediately visible.
            feat: Invoke-Status now shows unpushed commit counts for both public and private
            repos, with actionable hints ("run 'push'" / "run 'private push'").
            Added helpers: Get-PublicAheadCount, Get-PrivateAheadCount, Test-PrivateDirty.
            fix: Added UTF-8 BOM to file - PowerShell 5.1 defaults to ANSI without BOM, causing
            em-dash and Unicode characters to corrupt the parser and produce 34 cascading parse
            errors that prevented the script from loading. All angle-bracket placeholders in
            usage strings (<param>) replaced with curly-brace style ({param}) to avoid
            PowerShell treating '<' as a reserved redirection operator in string contexts.
    2.3.5 - fix: Test-PrivateRepo no longer requires commits to exist. Previously it called
            rev-parse HEAD which fails on a freshly-cloned empty private repo, blocking every
            private sub-command (save, push, status, log) with "no commits" error. Now uses
            rev-parse --git-dir which validates the bare repo structure without needing any
            commits, so operations work immediately after setup on a new empty remote.
            fix: Invoke-PrivateStatus and Invoke-PrivateLog guard the git log call and show a
            friendly "(no commits yet)" message instead of a git error on an empty repo.
    2.3.4 - fix: Invoke-PrivateMigration Step 5 no longer silently skips the push when
            ls-remote fails (auth error, network issue, or unreachable remote). Previously
            $shouldPush was gated on $LASTEXITCODE from ls-remote, so any ls-remote failure
            caused the push to be silently skipped. Now: if local commits exist and remoteInfo
            is empty (for any reason), the push is always attempted so the real error surfaces.
            fix: removed 2>$null from the private push in Step 5 so authentication and network
            errors are visible to the user instead of being swallowed silently.
            fix: Invoke-PrivateSetup now checks if the remote has commits before attempting
            checkout; for new empty repos the restore step is skipped gracefully instead of
            showing a confusing "main branch may not exist" warning.
            fix: Invoke-PrivateSetup uses Get-PrivateDefaultBranch for the checkout instead
            of hardcoded "main", handling repos whose default branch is not "main".
            fix: removed misleading "Run 'git-helper private push'" hint from end of
            Invoke-PrivateSetup -Invoke-PrivateMigration already handles the push.
    2.3.3 - fix: .private-git/ added to $PRIVATE_GIT_ALWAYS_IGNORE so it is always written to
            .gitignore regardless of $PRIVATE_PATHS, preventing bare-repo internals from being
            staged by `git add .` during release.
            fix: gitignore presence check now matches actual gitignore lines (anchored regex)
            instead of a raw substring search on the full file content, which previously caused
            entries like `docs` to be considered "already covered" by matching the word in a
            comment line, leaving /docs absent from .gitignore.
    2.3.2 - fix: Step 5 private push now compares local HEAD SHA vs remote SHA via ls-remote
            instead of rev-list "refs/remotes/origin/<branch>..HEAD". Bare repos have no remote
            tracking refs so the rev-list range silently returned nothing, causing the push to
            be skipped on subsequent runs (e.g. docs committed locally but never pushed).
    2.3.1 - fix: Invoke-PrivateMigration now also pushes the public repo after committing the
            cleanup (git rm --cached + .gitignore). Previously the public cleanup commit was
            only made locally, leaving docs/AI files visible on the remote until a manual push.
            Added Step 6: detect if local public branch is ahead of origin and auto-push.
    2.3.0 - $PRIVATE_PATHS now supports glob patterns; added AGENT.md and .agent* entries.
            .cursor* glob replaces individual .cursor / .cursor-rules entries, catching all
            cursor files and dirs (.cursorrules, .cursorignore, .cursorconfig, etc.).
            Added Get-PrivateDiskPaths helper that expands globs to actual on-disk paths;
            used by both Invoke-PrivateSave and Invoke-PrivateMigration.
    2.2.2 - fix: private commit step now checks git diff --cached before running commit,
            eliminating "nothing to commit" noise when files are already up to date.
            fix: push in step 5 now compares local HEAD vs remote ref directly (ls-remote +
            rev-list) so unpushed commits from previous runs are always flushed, not just
            commits made in the current migration run.
    2.2.1 - fix: Invoke-PrivateMigration now auto-pushes to private remote after committing
            (previously files were only committed locally, never pushed).
            fix: .gitignore update in step 1 is now correctly staged before the public commit
            (previously only staged when $toAdd was non-empty, causing the commit to be skipped).
    2.2.0 - Invoke-PrivateMigration: replaces Move-PrivateFilesFromPublic with an automatic,
            prompt-free migration that runs on setup AND every private sync / syncall:
            - Pushes ALL on-disk $PRIVATE_PATHS (AI/Cursor/docs) into the private repo.
            - Removes any still tracked in the public repo (git rm --cached).
            - Ensures .gitignore covers all $PRIVATE_PATHS so re-commits can't happen.
            - Runs after every successful pull so repos stay clean over time.
    2.1.1 - fix: private sync/push/syncall failed with "couldn't find remote ref HEAD" on bare repos.
            Added Get-PrivateDefaultBranch helper (reads remote symref, falls back to 'main').
            All private pull/push operations now use explicit 'origin <branch>' instead of bare 'pull'/'push'.
            Empty remote repos (no commits yet) are now detected and skipped gracefully instead of erroring.
    2.1.0 - private setup now auto-migrates AI/Cursor config files from the public repo:
            - Ensures ALL $PRIVATE_PATHS entries are added to .gitignore (even if no files
              are tracked), so the script is portable to repos with incomplete .gitignore files.
            - Detects any $PRIVATE_PATHS tracked in the public repo, prompts to migrate them:
              stages + commits to private repo, removes from public tracking, commits cleanup.
            - .gitignore is always committed whether or not a migration takes place.
    2.0.0 - Initial release with interactive menu, public + private repo management.
#>

param(
    [Parameter(Position = 0)]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$Arg1,

    [Parameter(Position = 2)]
    [string]$Arg2,

    [Parameter(Position = 3)]
    [string]$Arg3
)

#region Configuration

# Bare repo directory for private config (lives inside the project root, gitignored)
$PRIVATE_GIT_DIR = ".private-git"

# Paths managed by the private repo -supports exact names and glob patterns (e.g. ".cursor*")
$PRIVATE_PATHS = @(".claude", ".cursor*", "docs", "CLAUDE.md", "AGENT.md", ".agent*")

# Paths that must always be in .gitignore regardless of $PRIVATE_PATHS.
# The bare private-git directory must never be staged into the public repo.
$PRIVATE_GIT_ALWAYS_IGNORE = @($PRIVATE_GIT_DIR)

#endregion

#region Helper Functions

function Write-Colour {
    param(
        [string]$Text,
        [ConsoleColor]$Colour = "White",
        [switch]$NoNewLine
    )
    if ($NoNewLine) {
        Write-Host $Text -ForegroundColor $Colour -NoNewline
    } else {
        Write-Host $Text -ForegroundColor $Colour
    }
}

function Write-Success { param([string]$Text) Write-Colour $Text -Colour Green }
function Write-Error   { param([string]$Text) Write-Colour $Text -Colour Red }
function Write-Warning { param([string]$Text) Write-Colour $Text -Colour Yellow }
function Write-Info    { param([string]$Text) Write-Colour $Text -Colour Cyan }
function Write-Subtle  { param([string]$Text) Write-Colour $Text -Colour DarkGray }

function Get-CurrentBranch {
    $branch = git branch --show-current 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($branch)) {
        return "not a git repo"
    }
    return $branch
}

# Returns the number of commits the local public branch is ahead of its remote tracking branch.
# Returns 0 if up to date or if remote tracking is not configured.
function Get-PublicAheadCount {
    $branch = Get-CurrentBranch
    $ahead = git rev-list --count "origin/$branch..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($ahead)) { return 0 }
    return [int]$ahead
}

# Returns the number of commits the local private repo is ahead of its remote.
# Returns 0 if up to date, not set up, or no commits exist.
function Get-PrivateAheadCount {
    $gitDir = Get-PrivateGitDir
    if (-not $gitDir -or -not (Test-Path $gitDir)) { return 0 }

    $hasCommits = -not [string]::IsNullOrEmpty((& git --git-dir="$gitDir" rev-parse HEAD 2>$null))
    if (-not $hasCommits) { return 0 }

    $branch    = Get-PrivateDefaultBranch
    $localSha  = & git --git-dir="$gitDir" rev-parse HEAD 2>$null
    $remoteSha = & git --git-dir="$gitDir" ls-remote --heads origin $branch 2>$null |
                   ForEach-Object { ($_ -split '\s+')[0] }

    if ([string]::IsNullOrEmpty($remoteSha)) {
        # Remote has no commits -everything local is unpushed
        $count = & git --git-dir="$gitDir" rev-list --count HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { return 0 }
        return [int]$count
    }
    if ($localSha -eq $remoteSha) { return 0 }

    # Count commits between remote SHA and local HEAD
    $count = & git --git-dir="$gitDir" rev-list --count "$remoteSha..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0) { return 1 }  # at least 1 if SHAs differ
    return [int]$count
}

# Checks for uncommitted changes in the private repo. Returns $true if dirty.
function Test-PrivateDirty {
    $gitDir = Get-PrivateGitDir
    if (-not $gitDir -or -not (Test-Path $gitDir)) { return $false }

    $root = Get-RepoRoot
    $existingPaths = Get-PrivateDiskPaths
    if ($existingPaths.Count -eq 0) { return $false }

    $changes = & git --git-dir="$gitDir" --work-tree="$root" status --porcelain -- @existingPaths 2>$null | Out-String
    return -not [string]::IsNullOrWhiteSpace($changes)
}

function Test-GitRepo {
    git rev-parse --git-dir 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Error: Not a git repository. Please run this from within a git project."
        return $false
    }
    return $true
}

function Get-Confirmation {
    param([string]$Message)
    Write-Warning "$Message"
    Write-Colour "Type 'yes' to confirm: " -Colour Yellow -NoNewLine
    $response = Read-Host
    return ($response -eq "yes")
}

function Show-CommandHeader {
    param([string]$Title)
    Write-Host ""
    Write-Info "─── $Title ───"
    Write-Host ""
}

# Returns the absolute path to the repo root, or $null if not in a repo.
function Get-RepoRoot {
    $root = git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($root)) { return $null }
    return $root.Trim()
}

# Returns the absolute path to the private bare git dir.
function Get-PrivateGitDir {
    $root = Get-RepoRoot
    if (-not $root) { return $null }
    return Join-Path $root $PRIVATE_GIT_DIR
}

# Expands $PRIVATE_PATHS glob patterns to actual paths that exist on disk.
function Get-PrivateDiskPaths {
    $root = Get-RepoRoot
    if (-not $root) { return @() }
    $paths = @()
    foreach ($pattern in $PRIVATE_PATHS) {
        if ($pattern -match '[*?]') {
            Get-ChildItem -Path $root -Filter $pattern -ErrorAction SilentlyContinue |
                ForEach-Object { $paths += $_.Name }
        } elseif (Test-Path (Join-Path $root $pattern)) {
            $paths += $pattern
        }
    }
    return $paths
}

# Returns $true if .private-git exists and is a valid bare git repo; prints an error otherwise.
function Test-PrivateRepo {
    $gitDir = Get-PrivateGitDir
    if (-not $gitDir -or -not (Test-Path $gitDir)) {
        Write-Error 'Private repo not initialised. Run: git-helper private setup {url}'
        return $false
    }
    # Verify the directory is a valid bare git repo (does NOT require commits to exist)
    & git --git-dir="$gitDir" rev-parse --git-dir 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Private repo directory exists but is not a valid git repo. Try deleting .private-git and re-running setup."
        return $false
    }
    return $true
}

# Runs a git command against the private bare repo with the project root as the work tree.
# Usage: Invoke-PrivateGit "status", "--short"
function Invoke-PrivateGit {
    param([string[]]$GitArgs)
    $root   = Get-RepoRoot
    $gitDir = Join-Path $root $PRIVATE_GIT_DIR
    & git --git-dir="$gitDir" --work-tree="$root" @GitArgs
}

#endregion

#region Public Repo Command Implementations

function Invoke-Release {
    param([string]$Version, [string]$Message)

    if ([string]::IsNullOrEmpty($Version) -or [string]::IsNullOrEmpty($Message)) {
        Write-Error 'Usage: git-helper release {version} {message}'
        Write-Subtle "Example: git-helper release v1.2.0 `"Fixed calculation bug`""
        return
    }

    Show-CommandHeader "RELEASE: $Version"

    Write-Info "Adding all changes..."
    git add .

    Write-Info "Creating commit..."
    git commit -m $Message

    Write-Info "Creating tag: $Version..."
    git tag -a $Version -m $Message

    $branch = Get-CurrentBranch
    Write-Info "Pushing to origin/$branch with tags..."
    git push origin $branch $Version

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Success "✓ Released $Version successfully!"
        Invoke-PrivateAutoPush
    } else {
        Write-Error "✗ Release failed. Check the output above for errors."
    }
}

function Invoke-Sync {
    Show-CommandHeader "SYNC"

    Write-Info "Fetching from remote..."
    git fetch --all --prune

    $branch = Get-CurrentBranch
    Write-Info "Pulling latest for $branch..."
    git pull origin $branch

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Local repository is now up to date."
    } else {
        Write-Error "✗ Sync encountered issues. You may have merge conflicts to resolve."
    }
}

function Invoke-Save {
    param([string]$Message)

    if ([string]::IsNullOrEmpty($Message)) {
        Write-Error 'Usage: git-helper save {message}'
        Write-Subtle "Example: git-helper save `"WIP: refactoring auth module`""
        return
    }

    Show-CommandHeader "SAVE"

    Write-Info "Adding all changes..."
    git add .

    Write-Info "Creating commit..."
    git commit -m $Message

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Changes saved locally. Use 'push' when ready to upload."
    } else {
        Write-Warning "Nothing to commit, or commit failed."
    }
}

# Best-effort push of private repo. Silently skips if .private-git is not set up,
# has no commits, or has nothing to push. Shows a warning on failure but never
# causes the calling command to fail.
function Invoke-PrivateAutoPush {
    $gitDir = Get-PrivateGitDir
    if (-not $gitDir -or -not (Test-Path $gitDir)) { return }

    # Verify it's a valid bare repo
    & git --git-dir="$gitDir" rev-parse --git-dir 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return }

    # Check if there are any local commits at all
    $hasCommits = -not [string]::IsNullOrEmpty((& git --git-dir="$gitDir" rev-parse HEAD 2>$null))
    if (-not $hasCommits) { return }

    # Check if local is ahead of remote (has unpushed commits)
    $branch = Get-PrivateDefaultBranch
    $localSha  = & git --git-dir="$gitDir" rev-parse HEAD 2>$null
    $remoteSha = & git --git-dir="$gitDir" ls-remote --heads origin $branch 2>$null |
                   ForEach-Object { ($_ -split '\s+')[0] }
    if ($localSha -eq $remoteSha) { return }

    # Stage any changed private files before pushing
    $existingPaths = Get-PrivateDiskPaths
    if ($existingPaths.Count -gt 0) {
        Invoke-PrivateGit (@("add", "-f") + $existingPaths)
        $hasStagedChanges = -not [string]::IsNullOrEmpty((Invoke-PrivateGit @("diff", "--cached", "--name-only") 2>$null | Out-String).Trim())
        if ($hasStagedChanges) {
            Invoke-PrivateGit @("commit", "-m", "Auto-sync private config")
        }
    }

    Write-Host ""
    Write-Info "[PRIVATE] Pushing private config..."
    Invoke-PrivateGit @("push", "--set-upstream", "origin", $branch)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ Private config pushed."
    } else {
        Write-Warning "  ⚠ Private push failed -run 'git-helper private push' manually."
    }
}

function Invoke-Push {
    Show-CommandHeader "PUSH"

    $branch = Get-CurrentBranch
    Write-Info "Pushing $branch to remote..."
    git push origin $branch

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Pushed to origin/$branch successfully."
        Invoke-PrivateAutoPush
    } else {
        Write-Error "✗ Push failed. You may need to sync first."
    }
}

function Invoke-Status {
    Show-CommandHeader "STATUS"

    $branch = Get-CurrentBranch
    Write-Colour "Branch: " -Colour White -NoNewLine
    Write-Colour $branch -Colour Cyan
    Write-Host ""

    Write-Info "─── Public Repo ───"
    git status --short

    $changes = git status --porcelain
    if ([string]::IsNullOrEmpty($changes)) {
        Write-Subtle "  (no uncommitted changes)"
    }

    # Unpushed public commits
    $publicAhead = Get-PublicAheadCount
    if ($publicAhead -gt 0) {
        Write-Warning "  ⚠ $publicAhead unpushed commit(s) -run 'push' or 'release'"
    } else {
        Write-Subtle "  (up to date with remote)"
    }

    Write-Host ""
    Write-Info "─── Recent Commits ───"
    git log --oneline -5

    # Brief private config summary if the private repo is initialised
    $gitDir = Get-PrivateGitDir
    if ($gitDir -and (Test-Path $gitDir)) {
        Write-Host ""
        Write-Info "─── Private Config ───"
        $privateChanges = Invoke-PrivateGit @("status", "--porcelain") 2>$null | Out-String
        if ([string]::IsNullOrWhiteSpace($privateChanges)) {
            Write-Subtle "  (no uncommitted changes)"
        } else {
            Invoke-PrivateGit @("status", "--short")
        }

        # Unpushed private commits
        $privateAhead = Get-PrivateAheadCount
        if ($privateAhead -gt 0) {
            Write-Warning "  ⚠ $privateAhead unpushed private commit(s) -run 'private push'"
        } elseif (Test-PrivateDirty) {
            Write-Warning '  ⚠ Uncommitted private changes - run: private save {msg}'
        } else {
            Write-Subtle "  (up to date with remote)"
        }
    }

    Write-Host ""
}

function Invoke-NewBranch {
    param([string]$BranchName)

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error 'Usage: git-helper newbranch {branch-name}'
        Write-Subtle "Example: git-helper newbranch feature/new-login"
        return
    }

    Show-CommandHeader "NEW BRANCH: $BranchName"

    Write-Info "Creating and switching to $BranchName..."
    git checkout -b $BranchName

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Created and switched to '$BranchName'."
    } else {
        Write-Error "✗ Failed to create branch. It may already exist."
    }
}

function Invoke-SwitchTo {
    param([string]$BranchName)

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error 'Usage: git-helper switchto {branch-name}'
        Write-Subtle "Example: git-helper switchto main"
        Write-Host ""
        Write-Info "Available local branches:"
        git branch
        return
    }

    Show-CommandHeader "SWITCH TO: $BranchName"

    git checkout $BranchName

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Switched to '$BranchName'."
    } else {
        Write-Error "✗ Failed to switch. Branch may not exist or you have uncommitted changes."
    }
}

function Invoke-Branches {
    param([string]$Scope = "local")

    Show-CommandHeader "BRANCHES"

    switch ($Scope.ToLower()) {
        "local"  { Write-Info "Local branches:";                git branch }
        "remote" { Write-Info "Remote branches:";               git branch -r }
        "all"    { Write-Info "All branches (local + remote):"; git branch -a }
        default  { Write-Warning "Unknown scope: $Scope"; Write-Subtle "Options: local, remote, all" }
    }
}

function Invoke-Merge {
    param([string]$BranchName)

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error 'Usage: git-helper merge {branch-name}'
        Write-Subtle "Example: git-helper merge feature/login"
        return
    }

    Show-CommandHeader "MERGE: $BranchName"

    $currentBranch = Get-CurrentBranch
    Write-Info "Merging '$BranchName' into '$currentBranch'..."
    git merge $BranchName

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Merged '$BranchName' into '$currentBranch'."
    } else {
        Write-Error "✗ Merge failed. You may have conflicts to resolve."
    }
}

function Invoke-Delete {
    param([string]$BranchName, [string]$Scope = "local")

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error 'Usage: git-helper delete {branch-name} [local|remote|both]'
        Write-Subtle "Example: git-helper delete feature/old-stuff remote"
        return
    }

    Show-CommandHeader "DELETE BRANCH: $BranchName"

    if (-not (Get-Confirmation "This will delete branch '$BranchName' ($Scope). This cannot be undone easily.")) {
        Write-Warning "Cancelled."
        return
    }

    switch ($Scope.ToLower()) {
        "local"  { Write-Info "Deleting local branch...";  git branch -d $BranchName }
        "remote" { Write-Info "Deleting remote branch..."; git push origin --delete $BranchName }
        "both"   {
            Write-Info "Deleting local branch..."
            git branch -d $BranchName
            Write-Info "Deleting remote branch..."
            git push origin --delete $BranchName
        }
        default { Write-Warning "Unknown scope: $Scope. Use: local, remote, both"; return }
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Branch '$BranchName' deleted ($Scope)."
    } else {
        Write-Error "✗ Delete failed. Branch may not exist or is not fully merged."
        Write-Subtle "Use 'git branch -D $BranchName' to force delete unmerged branches."
    }
}

function Invoke-Tags {
    param([string]$Action = "list", [string]$TagName, [string]$Message)

    Show-CommandHeader "TAGS"

    switch ($Action.ToLower()) {
        "list" {
            Write-Info "Tags (newest first):"
            $tags = git tag --sort=-creatordate
            if ([string]::IsNullOrEmpty($tags)) { Write-Subtle "  (no tags found)" }
            else { git tag --sort=-creatordate }
        }
        "create" {
            if ([string]::IsNullOrEmpty($TagName)) {
                Write-Error 'Usage: git-helper tags create {tag-name} {message}'
                Write-Subtle 'Example: git-helper tags create v1.0.0 "Initial release"'
                return
            }
            if ([string]::IsNullOrEmpty($Message)) { $Message = $TagName }
            Write-Info "Creating tag: $TagName..."
            git tag -a $TagName -m $Message
            if ($LASTEXITCODE -eq 0) {
                Write-Success "✓ Tag '$TagName' created locally."
                Write-Subtle "Use 'git-helper tags push' to push tags to remote."
            }
        }
        "delete" {
            if ([string]::IsNullOrEmpty($TagName)) {
                Write-Error 'Usage: git-helper tags delete {tag-name}'
                return
            }
            if (-not (Get-Confirmation "Delete tag '$TagName'?")) { Write-Warning "Cancelled."; return }
            Write-Info "Deleting local tag..."
            git tag -d $TagName
            Write-Info "Deleting remote tag..."
            git push origin --delete $TagName
            Write-Success "✓ Tag '$TagName' deleted."
        }
        "push" {
            Write-Info "Pushing all tags to remote..."
            git push --tags
            if ($LASTEXITCODE -eq 0) { Write-Success "✓ Tags pushed to remote." }
        }
        default { Write-Warning "Unknown action: $Action"; Write-Subtle "Options: list, create, delete, push" }
    }
}

function Invoke-Stash {
    param([string]$Action = "list", [string]$Message)

    Show-CommandHeader "STASH"

    switch ($Action.ToLower()) {
        "list" {
            Write-Info "Stashed changes:"
            $stashes = git stash list
            if ([string]::IsNullOrEmpty($stashes)) { Write-Subtle "  (no stashes found)" }
            else { git stash list }
        }
        "save" {
            if ([string]::IsNullOrEmpty($Message)) { $Message = "WIP: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
            Write-Info "Stashing changes: $Message..."
            git stash push -m $Message
            if ($LASTEXITCODE -eq 0) { Write-Success "✓ Changes stashed. Use 'stash pop' to retrieve them." }
        }
        "pop" {
            Write-Info "Retrieving most recent stash..."
            git stash pop
            if ($LASTEXITCODE -eq 0) { Write-Success "✓ Stash applied and removed from stash list." }
            else { Write-Error "✗ Failed to pop stash. You may have conflicts." }
        }
        "drop" {
            if (-not (Get-Confirmation "This will permanently delete the most recent stash.")) {
                Write-Warning "Cancelled."
                return
            }
            Write-Info "Dropping most recent stash..."
            git stash drop
            Write-Success "✓ Stash dropped."
        }
        default { Write-Warning "Unknown action: $Action"; Write-Subtle "Options: list, save, pop, drop" }
    }
}

function Invoke-Log {
    param([int]$Count = 10)

    Show-CommandHeader "COMMIT LOG"

    Write-Info "Last $Count commits:"
    Write-Host ""
    git log --oneline --graph --decorate -$Count
}

function Invoke-Undo {
    Show-CommandHeader "UNDO LAST COMMIT"

    Write-Warning "This will undo your last commit but keep all file changes intact."
    Write-Subtle "Your changes will be staged and ready to recommit."
    Write-Host ""

    if (-not (Get-Confirmation "Undo the last commit?")) { Write-Warning "Cancelled."; return }

    git reset --soft HEAD~1

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Last commit undone. Your changes are still staged."
        Write-Subtle "Use 'git-helper status' to see your changes."
    } else {
        Write-Error "✗ Failed to undo. There may be no commits to undo."
    }
}

function Invoke-Discard {
    Show-CommandHeader "DISCARD ALL CHANGES"

    Write-Error "WARNING: This will permanently delete ALL uncommitted changes!"
    Write-Subtle "This includes modified files, staged changes, and untracked files."
    Write-Host ""

    Write-Info "Current uncommitted changes:"
    git status --short
    Write-Host ""

    if (-not (Get-Confirmation "Are you absolutely sure you want to discard everything?")) {
        Write-Warning "Cancelled. Your changes are safe."
        return
    }

    Write-Info "Resetting tracked files..."
    git checkout -- .

    Write-Info "Removing untracked files..."
    git clean -fd

    Write-Success "✓ All changes discarded. Repository is clean."
}

function Invoke-ForcePush {
    Show-CommandHeader "FORCE PUSH (local overrides remote)"

    $branch = Get-CurrentBranch
    Write-Error "WARNING: This will force-push '$branch' to remote, overwriting any remote changes!"
    Write-Subtle "Uses --force-with-lease for safety (fails if remote has commits you haven't fetched)."
    Write-Host ""

    Write-Info "Current local state:"
    git log --oneline -3
    Write-Host ""

    if (-not (Get-Confirmation "Force-push local '$branch' to remote? Remote commits not in your local will be lost.")) {
        Write-Warning "Cancelled."
        return
    }

    Write-Info "Force-pushing $branch to remote..."
    git push --force-with-lease origin $branch

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Force-pushed to origin/$branch. Remote now matches local."
    } else {
        Write-Error "✗ Force-push failed. Someone may have pushed since your last fetch."
        Write-Subtle "Run 'git-helper sync' first, then try again if needed."
    }
}

function Invoke-ForcePull {
    Show-CommandHeader "FORCE PULL (remote overrides local)"

    $branch = Get-CurrentBranch
    Write-Error "WARNING: This will discard ALL local commits on '$branch' and reset to match remote!"
    Write-Subtle "Uncommitted changes will also be lost."
    Write-Host ""

    # Show what will be lost
    $localAhead = Get-PublicAheadCount
    if ($localAhead -gt 0) {
        Write-Warning "You have $localAhead local commit(s) that will be LOST:"
        git log --oneline "origin/$branch..HEAD" 2>$null
        Write-Host ""
    }

    $dirty = git status --porcelain 2>$null
    if (-not [string]::IsNullOrEmpty($dirty)) {
        Write-Warning "Uncommitted changes that will be LOST:"
        git status --short
        Write-Host ""
    }

    if (-not (Get-Confirmation "Reset local '$branch' to match remote? All local-only changes will be permanently lost.")) {
        Write-Warning "Cancelled."
        return
    }

    Write-Info "Fetching latest from remote..."
    git fetch origin $branch

    if ($LASTEXITCODE -ne 0) {
        Write-Error "✗ Fetch failed. Check your network connection."
        return
    }

    Write-Info "Resetting local branch to match remote..."
    git reset --hard "origin/$branch"

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Local '$branch' now matches remote exactly."
    } else {
        Write-Error "✗ Reset failed. Check output above for errors."
    }
}

#endregion

#region Private Repo Command Implementations

function Invoke-PrivateStatus {
    Show-CommandHeader "PRIVATE CONFIG STATUS"

    if (-not (Test-PrivateRepo)) { return }

    $branch = Invoke-PrivateGit @("branch", "--show-current") 2>$null | Out-String
    Write-Colour "Branch: " -Colour White -NoNewLine
    Write-Colour $branch.Trim() -Colour Cyan
    Write-Host ""

    Write-Info "─── Changes ───"
    Invoke-PrivateGit @("status", "--short")

    $changes = Invoke-PrivateGit @("status", "--porcelain") | Out-String
    if ([string]::IsNullOrWhiteSpace($changes)) {
        Write-Subtle "  (no uncommitted changes)"
    }

    Write-Host ""
    Write-Info "─── Recent Commits ───"
    $gitDir = Get-PrivateGitDir
    $hasCommits = -not [string]::IsNullOrEmpty((& git --git-dir="$gitDir" rev-parse HEAD 2>$null))
    if ($hasCommits) {
        Invoke-PrivateGit @("log", "--oneline", "--graph", "--decorate", "-5")
    } else {
        Write-Subtle "  (no commits yet - use 'private save' with a message to make the first commit)"
    }
    Write-Host ""
}

# Returns the default branch name from the private remote (falls back to 'main').
function Get-PrivateDefaultBranch {
    $gitDir = Get-PrivateGitDir
    if (-not $gitDir) { return "main" }
    $symref = & git --git-dir="$gitDir" ls-remote --symref origin HEAD 2>$null |
              Select-String "^ref: refs/heads/(\S+)\s+HEAD" |
              ForEach-Object { $_.Matches[0].Groups[1].Value } |
              Select-Object -First 1
    if ($symref) { return $symref }
    return "main"
}

function Invoke-PrivateSync {
    Show-CommandHeader "PRIVATE CONFIG SYNC"

    if (-not (Test-PrivateRepo)) { return }

    $gitDir = Get-PrivateGitDir

    # Guard: remote may be empty (no commits pushed yet)
    $remoteRefs = & git --git-dir="$gitDir" ls-remote --heads origin 2>$null
    if ([string]::IsNullOrWhiteSpace($remoteRefs)) {
        Write-Warning "Remote private repo has no commits yet -nothing to pull."
        Write-Subtle "Push your first commit with 'git-helper private push'."
        return
    }

    $branch = Get-PrivateDefaultBranch
    Write-Info "Pulling latest private config from remote (origin/$branch)..."
    Invoke-PrivateGit @("pull", "origin", $branch)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Private config is up to date."
        Write-Host ""
        Write-Info "Checking for AI/Cursor/docs files to migrate..."
        Invoke-PrivateMigration
    } else {
        Write-Error "✗ Pull failed. Check output above for errors."
    }
}

function Invoke-PrivateSave {
    param([string]$Message)

    if ([string]::IsNullOrEmpty($Message)) {
        Write-Error 'Usage: git-helper private save {message}'
        Write-Subtle "Example: git-helper private save `"Updated cursor rules`""
        return
    }

    if (-not (Test-PrivateRepo)) { return }

    Show-CommandHeader "PRIVATE CONFIG SAVE"

    # Only stage paths that exist on disk to avoid warnings for missing dirs
    $existingPaths = Get-PrivateDiskPaths
    if ($existingPaths.Count -eq 0) {
        Write-Warning "None of the configured private paths exist on disk."
        Write-Subtle "Paths: $($PRIVATE_PATHS -join ', ')"
        return
    }

    Write-Info "Staging private files..."
    Invoke-PrivateGit (@("add", "-f") + $existingPaths)

    Write-Info "Creating commit..."
    Invoke-PrivateGit @("commit", "-m", $Message)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Private config saved locally. Use 'private push' to upload."
    } else {
        Write-Warning "Nothing to commit, or commit failed."
    }
}

function Invoke-PrivatePush {
    Show-CommandHeader "PRIVATE CONFIG PUSH"

    if (-not (Test-PrivateRepo)) { return }

    $branch = Get-PrivateDefaultBranch
    Write-Info "Pushing private config to remote (origin/$branch)..."
    Invoke-PrivateGit @("push", "--set-upstream", "origin", $branch)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Private config pushed."
    } else {
        Write-Error "✗ Push failed. Try 'private sync' first."
    }
}

function Invoke-PrivateAdd {
    param([string]$FilePath)

    if ([string]::IsNullOrEmpty($FilePath)) {
        Write-Error 'Usage: git-helper private add {file-path}'
        Write-Subtle "Example: git-helper private add .claude/settings.local.json"
        return
    }

    if (-not (Test-PrivateRepo)) { return }

    Show-CommandHeader "PRIVATE ADD: $FilePath"

    if (-not (Test-Path $FilePath)) {
        Write-Error "File not found: $FilePath"
        return
    }

    Invoke-PrivateGit @("add", "-f", $FilePath)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Staged: $FilePath"
        Write-Subtle 'Use: private save {msg} to commit, then: private push to upload.'
    } else {
        Write-Error "✗ Failed to stage file."
    }
}

function Invoke-PrivateLog {
    param([int]$Count = 10)

    if (-not (Test-PrivateRepo)) { return }

    Show-CommandHeader "PRIVATE CONFIG LOG"

    $gitDir = Get-PrivateGitDir
    $hasCommits = -not [string]::IsNullOrEmpty((& git --git-dir="$gitDir" rev-parse HEAD 2>$null))
    if (-not $hasCommits) {
        Write-Subtle "  (no commits yet - use 'private save' with a message to make the first commit)"
        Write-Host ""
        return
    }

    Write-Info "Last $Count commits:"
    Write-Host ""
    Invoke-PrivateGit @("log", "--oneline", "--graph", "--decorate", "-$Count")
    Write-Host ""
}

function Invoke-PrivateForcePush {
    Show-CommandHeader "PRIVATE FORCE PUSH (local overrides remote)"

    if (-not (Test-PrivateRepo)) { return }

    $branch = Get-PrivateDefaultBranch
    Write-Error "WARNING: This will force-push private config to remote, overwriting remote changes!"
    Write-Host ""

    $gitDir = Get-PrivateGitDir
    $hasCommits = -not [string]::IsNullOrEmpty((& git --git-dir="$gitDir" rev-parse HEAD 2>$null))
    if ($hasCommits) {
        Write-Info "Current local private commits:"
        Invoke-PrivateGit @("log", "--oneline", "-3")
        Write-Host ""
    }

    if (-not (Get-Confirmation "Force-push local private config to remote? Remote-only commits will be lost.")) {
        Write-Warning "Cancelled."
        return
    }

    Write-Info "Force-pushing private config to remote (origin/$branch)..."
    # Use --force (not --force-with-lease) because bare repos via --git-dir have no
    # remote tracking refs, so --force-with-lease always rejects the push.
    Invoke-PrivateGit @("push", "--force", "--set-upstream", "origin", $branch)

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Private config force-pushed. Remote now matches local."
    } else {
        Write-Error "✗ Force-push failed. Check network/auth. Do NOT run 'private sync' — that would merge remote changes into local."
    }
}

function Invoke-PrivateForcePull {
    Show-CommandHeader "PRIVATE FORCE PULL (remote overrides local)"

    if (-not (Test-PrivateRepo)) { return }

    $gitDir = Get-PrivateGitDir
    $branch = Get-PrivateDefaultBranch

    # Guard: remote may be empty
    $remoteRefs = & git --git-dir="$gitDir" ls-remote --heads origin 2>$null
    if ([string]::IsNullOrWhiteSpace($remoteRefs)) {
        Write-Warning "Remote private repo has no commits yet - nothing to pull."
        return
    }

    Write-Error "WARNING: This will discard ALL local private commits and reset to match remote!"
    Write-Host ""

    $privateAhead = Get-PrivateAheadCount
    if ($privateAhead -gt 0) {
        Write-Warning "You have $privateAhead local private commit(s) that will be LOST."
        Write-Host ""
    }

    if (Test-PrivateDirty) {
        Write-Warning "Uncommitted private config changes will also be LOST."
        Write-Host ""
    }

    if (-not (Get-Confirmation "Reset local private config to match remote? All local-only changes will be permanently lost.")) {
        Write-Warning "Cancelled."
        return
    }

    Write-Info "Fetching latest private config from remote..."
    & git --git-dir="$gitDir" fetch origin $branch

    if ($LASTEXITCODE -ne 0) {
        Write-Error "✗ Fetch failed. Check your network connection."
        return
    }

    Write-Info "Resetting private repo to match remote..."
    & git --git-dir="$gitDir" update-ref "refs/heads/$branch" "refs/remotes/origin/$branch"

    if ($LASTEXITCODE -ne 0) {
        # Fallback: try FETCH_HEAD
        & git --git-dir="$gitDir" update-ref "refs/heads/$branch" FETCH_HEAD
    }

    if ($LASTEXITCODE -eq 0) {
        # Restore files to working tree
        $root = Get-RepoRoot
        Write-Info "Restoring private files to working tree..."
        & git --git-dir="$gitDir" --work-tree="$root" checkout $branch -- .
        Write-Success "✓ Private config now matches remote exactly."
    } else {
        Write-Error "✗ Reset failed. Check output above for errors."
    }
}

# Ensures all $PRIVATE_PATHS are in .gitignore, pushed into the private repo,
# and removed from public tracking. Called automatically during setup and sync.
function Invoke-PrivateMigration {
    $root   = Get-RepoRoot
    $gitDir = Get-PrivateGitDir
    if (-not $root -or -not $gitDir -or -not (Test-Path $gitDir)) { return }

    # --- Step 1: Ensure ALL private paths are in .gitignore ---
    $gitignorePath = Join-Path $root ".gitignore"
    $existingLines = if (Test-Path $gitignorePath) { Get-Content $gitignorePath } else { @() }

    # Check for a line that matches the pattern as an actual gitignore entry (not in comments).
    # Anchored to handle both /pattern and pattern forms.
    function Test-GitignoreCoversPattern {
        param([string]$Pat, [string[]]$Lines)
        $escaped = [regex]::Escape($Pat)
        return ($Lines | Where-Object { $_ -match "^/?$escaped/?$" }).Count -gt 0
    }

    $allRequiredPaths = $PRIVATE_PATHS + $PRIVATE_GIT_ALWAYS_IGNORE
    $toAdd = $allRequiredPaths | Where-Object { -not (Test-GitignoreCoversPattern $_ $existingLines) }
    if ($toAdd.Count -gt 0) {
        Write-Info "  Updating .gitignore ($($toAdd -join ', '))..."
        $block = "`n# AI / Cursor / docs configs (managed by private repo)`n" + ($toAdd | ForEach-Object { "/$_" } | Out-String).TrimEnd()
        Add-Content -Path $gitignorePath -Value $block -NoNewline:$false
        Write-Success "  ✓ .gitignore updated."
    }

    # --- Step 2: Stage and commit all on-disk private paths into the private repo ---
    $diskPaths = Get-PrivateDiskPaths
    if ($diskPaths.Count -gt 0) {
        & git --git-dir="$gitDir" --work-tree="$root" add -f @diskPaths 2>$null
        # Only commit if something was actually staged (avoids noisy "nothing to commit" output)
        $privateStaged = & git --git-dir="$gitDir" diff --cached --name-only 2>$null
        if (-not [string]::IsNullOrWhiteSpace($privateStaged)) {
            & git --git-dir="$gitDir" --work-tree="$root" commit -m "chore: sync AI/Cursor/docs config to private repo"
            if ($LASTEXITCODE -eq 0) { Write-Success "  ✓ Private config committed ($($diskPaths -join ', '))." }
        }
    }

    # --- Step 3: Remove any still tracked in the public repo ---
    $trackedPaths = $PRIVATE_PATHS | Where-Object {
        -not [string]::IsNullOrEmpty((git ls-files $_ 2>$null))
    }
    if ($trackedPaths.Count -gt 0) {
        Write-Info "  Removing $($trackedPaths -join ', ') from public repo tracking..."
        foreach ($path in $trackedPaths) { git rm -r --cached $path 2>$null | Out-Null }
    }

    # --- Step 4: Commit public repo changes (.gitignore update + index removals) ---
    if ($toAdd.Count -gt 0) { git add .gitignore 2>$null | Out-Null }
    $staged = git diff --cached --name-only 2>$null
    if (-not [string]::IsNullOrWhiteSpace($staged)) {
        git commit -m "chore: remove AI/Cursor/docs config from public repo -now in private"
        if ($LASTEXITCODE -eq 0) { Write-Success "  ✓ Public repo cleanup committed." }
    }

    # --- Step 5: Push private repo if local is ahead of remote ---
    # Use ls-remote for the SHA comparison -bare repos often have no remote tracking refs,
    # so rev-list "refs/remotes/origin/<branch>..HEAD" silently returns nothing.
    $branch = Get-PrivateDefaultBranch
    $localHead  = (& git --git-dir="$gitDir" rev-parse HEAD 2>$null).Trim()
    if (-not [string]::IsNullOrEmpty($localHead)) {
        $remoteInfo = & git --git-dir="$gitDir" ls-remote origin $branch 2>$null
        if ([string]::IsNullOrWhiteSpace($remoteInfo)) {
            # Remote branch doesn't exist yet, OR ls-remote failed (auth/network error).
            # In either case attempt the push -the push itself will surface the real error.
            $shouldPush = $true
        } else {
            # Remote exists -push only if local SHA differs from remote SHA
            $remoteSha = ($remoteInfo -split '\s+')[0].Trim()
            $shouldPush = ($localHead -ne $remoteSha)
        }
    } else {
        $shouldPush = $false  # No local commits yet; nothing to push
    }
    if ($shouldPush) {
        Write-Info "  Pushing private config to remote (origin/$branch)..."
        & git --git-dir="$gitDir" push --set-upstream origin $branch
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✓ Private config pushed to remote."
        } else {
            Write-Warning "  Push failed -run 'git-helper private push' to retry."
        }
    }

    # --- Step 6: Push public repo if local is ahead of remote ---
    $pubBranch = Get-CurrentBranch
    $pubAhead = git rev-list --count "origin/$pubBranch..HEAD" 2>$null
    if ($pubAhead -match '^\d+$' -and [int]$pubAhead -gt 0) {
        Write-Info "  Pushing public repo cleanup to remote (origin/$pubBranch)..."
        git push origin $pubBranch 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✓ Public repo pushed to remote."
        } else {
            Write-Warning "  Public push failed -run 'git push' to retry."
        }
    }
}

function Invoke-PrivateSetup {
    param([string]$Url)

    Show-CommandHeader "PRIVATE REPO SETUP"

    $root = Get-RepoRoot
    if (-not $root) { Write-Error "Not in a git repository."; return }

    $gitDir = Join-Path $root $PRIVATE_GIT_DIR

    if (Test-Path $gitDir) {
        Write-Error "✗ Private repo already exists at $gitDir"
        Write-Subtle "  To re-initialise, delete the .private-git folder first, then re-run setup."
        exit 1
    }

    # Auto-derive URL from public remote if not supplied
    if ([string]::IsNullOrEmpty($Url)) {
        $publicUrl = git remote get-url origin 2>$null
        if ($publicUrl -and $LASTEXITCODE -eq 0) {
            $derived = $publicUrl -replace "\.git$", "-private.git"
            Write-Info "Derived private repo URL: $derived"
            Write-Colour "Is this correct? (y/n): " -Colour Yellow -NoNewLine
            $confirm = Read-Host
            if ($confirm -eq "y") {
                $Url = $derived
            } else {
                Write-Colour "Enter private repo URL: " -Colour Yellow -NoNewLine
                $Url = Read-Host
            }
        } else {
            Write-Error 'Usage: git-helper private setup {url}'
            Write-Subtle "Example: git-helper private setup https://github.com/user/repo-private.git"
            return
        }
    }

    Write-Info "Cloning private repo as bare repo into $PRIVATE_GIT_DIR ..."
    & git clone --bare $Url $gitDir

    if ($LASTEXITCODE -ne 0) {
        Write-Error "✗ Clone failed. Check the URL and your GitHub credentials."
        return
    }

    $remoteHasCommits = & git --git-dir="$gitDir" ls-remote --heads origin 2>$null
    if (-not [string]::IsNullOrWhiteSpace($remoteHasCommits)) {
        Write-Info "Restoring private files to working tree..."
        $setupBranch = Get-PrivateDefaultBranch
        & git --git-dir="$gitDir" --work-tree="$root" checkout $setupBranch -- .
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Checkout step had issues -run 'git-helper private status' to verify."
        }
    } else {
        Write-Subtle "  (New empty private repo - restore step skipped.)"
    }

    Write-Info "Configuring private repo (suppress untracked-file noise)..."
    & git --git-dir="$gitDir" --work-tree="$root" config status.showUntrackedFiles no

    Write-Host ""
    Write-Success "✓ Private repo set up. Run 'git-helper private status' to verify."

    # Push all AI/Cursor/docs files into private repo and clean up public repo
    Write-Host ""
    Write-Info "Migrating AI/Cursor/docs config to private repo..."
    Invoke-PrivateMigration
}

# Dispatcher for all "private" sub-commands
function Invoke-Private {
    param([string]$SubCommand, [string]$SubArg1, [string]$SubArg2)

    if ([string]::IsNullOrEmpty($SubCommand)) {
        # No sub-command -show private status as default
        Invoke-PrivateStatus
        return
    }

    switch ($SubCommand.ToLower()) {
        "status" { Invoke-PrivateStatus }
        "sync"   { Invoke-PrivateSync }
        "pull"   { Invoke-PrivateSync }   # alias for sync
        "save"   { Invoke-PrivateSave  -Message  $SubArg1 }
        "push"   { Invoke-PrivatePush }
        "add"    { Invoke-PrivateAdd   -FilePath $SubArg1 }
        "log"        { Invoke-PrivateLog       -Count $(if ($SubArg1) { [int]$SubArg1 } else { 10 }) }
        "setup"      { Invoke-PrivateSetup    -Url   $SubArg1 }
        "force-push" { Invoke-PrivateForcePush }
        "force-pull" { Invoke-PrivateForcePull }
        default {
            Write-Error "Unknown private sub-command: $SubCommand"
            Write-Subtle "Options: status, sync, save, push, add, log, setup, force-push, force-pull"
        }
    }
}

#endregion

#region SyncAll

# Full bidirectional sync: pull then push for both public and private repos.
function Invoke-SyncAll {
    Show-CommandHeader "SYNC ALL (public + private)"

    $publicOk  = $true
    $privateOk = $true

    # ── Public: Pull ──
    Write-Info "[PUBLIC] Fetching and pulling..."
    git fetch --all --prune
    $branch = Get-CurrentBranch
    git pull origin $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Error "  ✗ Public pull had issues."
        $publicOk = $false
    } else {
        Write-Success "  ✓ Public repo pulled."
    }

    # ── Public: Auto-commit (if dirty) ──
    if ($publicOk) {
        $publicDirty = -not [string]::IsNullOrEmpty((git status --porcelain 2>$null))
        if ($publicDirty) {
            Write-Info "[PUBLIC] Staging and committing uncommitted changes..."
            git add .
            git commit -m "Auto-sync public changes"
            if ($LASTEXITCODE -eq 0) {
                Write-Success "  ✓ Public changes committed."
            } else {
                Write-Subtle "  (nothing to commit)"
            }
        }
    }

    # ── Public: Push (if ahead) ──
    if ($publicOk) {
        $publicAhead = Get-PublicAheadCount
        if ($publicAhead -gt 0) {
            Write-Info "[PUBLIC] Pushing $publicAhead unpushed commit(s)..."
            git push origin $branch
            if ($LASTEXITCODE -eq 0) {
                Write-Success "  ✓ Public repo pushed."
            } else {
                Write-Error "  ✗ Public push failed."
                $publicOk = $false
            }
        } else {
            Write-Subtle "  (nothing to push)"
        }
    }

    # ── Private: Pull ──
    $gitDir = Get-PrivateGitDir
    if ($gitDir -and (Test-Path $gitDir)) {
        Write-Host ""
        Write-Info "[PRIVATE] Pulling..."
        $remoteRefs = & git --git-dir="$gitDir" ls-remote --heads origin 2>$null
        if ([string]::IsNullOrWhiteSpace($remoteRefs)) {
            Write-Subtle "  [PRIVATE] Remote has no commits yet -skipping pull."
        } else {
            $privBranch = Get-PrivateDefaultBranch
            Invoke-PrivateGit @("pull", "origin", $privBranch)
            if ($LASTEXITCODE -ne 0) {
                Write-Error "  ✗ Private pull had issues."
                $privateOk = $false
            } else {
                Write-Success "  ✓ Private config pulled."
            }
        }

        if ($privateOk) {
            Write-Host ""
            Write-Info "[PRIVATE] Checking for AI/Cursor/docs files to migrate..."
            Invoke-PrivateMigration
        }

        # ── Private: Auto-commit + Push (if ahead or dirty) ──
        if ($privateOk) {
            # Stage and commit any uncommitted private changes
            $existingPaths = Get-PrivateDiskPaths
            if ($existingPaths.Count -gt 0) {
                Invoke-PrivateGit (@("add", "-f") + $existingPaths)
                $hasStagedChanges = -not [string]::IsNullOrEmpty((Invoke-PrivateGit @("diff", "--cached", "--name-only") 2>$null | Out-String).Trim())
                if ($hasStagedChanges) {
                    Write-Info "[PRIVATE] Committing changed private files..."
                    Invoke-PrivateGit @("commit", "-m", "Auto-sync private config")
                    if ($LASTEXITCODE -eq 0) {
                        Write-Success "  ✓ Private changes committed."
                    }
                }
            }

            $privateAhead = Get-PrivateAheadCount
            if ($privateAhead -gt 0) {
                $privBranch = Get-PrivateDefaultBranch
                Write-Info "[PRIVATE] Pushing $privateAhead unpushed commit(s)..."
                Invoke-PrivateGit @("push", "--set-upstream", "origin", $privBranch)
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "  ✓ Private config pushed."
                } else {
                    Write-Error "  ✗ Private push failed."
                    $privateOk = $false
                }
            } else {
                Write-Subtle "  (nothing to push)"
            }
        }
    } else {
        Write-Subtle "[PRIVATE] Skipped -.private-git not found. Run 'git-helper private setup' to initialise."
    }

    Write-Host ""
    if ($publicOk -and $privateOk) {
        Write-Success "✓ All repos fully synced."
    } else {
        Write-Error "✗ One or more repos had sync issues. See details above."
    }
}

#endregion

#region Help System

function Show-Help {
    param([string]$CommandName)

    $helpData = @{
        "release" = @{
            Usage       = 'git-helper release {version} {message}'
            Description = "When you're ready to publish a new version - bundles changes, creates version tag, and pushes everything."
            Examples    = @(
                "git-helper release v1.0.0 `"Initial release`"",
                "git-helper release v1.2.1 `"Fixed login bug`""
            )
        }
        "sync" = @{
            Usage       = "git-helper sync"
            Description = "Updates your local copy with all changes from remote. Do this before starting new work."
            Examples    = @("git-helper sync")
        }
        "save" = @{
            Usage       = 'git-helper save {message}'
            Description = "Checkpoint your work locally without pushing. Like hitting 'save' on a document."
            Examples    = @(
                "git-helper save `"WIP: auth refactor`"",
                "git-helper save `"Added validation`""
            )
        }
        "push" = @{
            Usage       = "git-helper push"
            Description = "Upload your committed changes to remote so others can see them."
            Examples    = @("git-helper push")
        }
        "status" = @{
            Usage       = "git-helper status"
            Description = "Quick overview - current branch, changed files, recent commits, and a brief private config summary."
            Examples    = @("git-helper status")
        }
        "newbranch" = @{
            Usage       = 'git-helper newbranch {branch-name}'
            Description = "Start work on a new feature/fix in isolation from main code."
            Examples    = @(
                "git-helper newbranch feature/login",
                "git-helper newbranch bugfix/header-crash"
            )
        }
        "switchto" = @{
            Usage       = 'git-helper switchto {branch-name}'
            Description = "Move to a different branch to work on something else."
            Examples    = @(
                "git-helper switchto main",
                "git-helper switchto feature/login"
            )
        }
        "branches" = @{
            Usage       = "git-helper branches [local|remote|all]"
            Description = "See what branches exist. Default shows local branches only."
            Examples    = @(
                "git-helper branches",
                "git-helper branches all",
                "git-helper branches remote"
            )
        }
        "merge" = @{
            Usage       = 'git-helper merge {branch-name}'
            Description = "Combine another branch's changes into your current branch."
            Examples    = @("git-helper merge feature/login")
        }
        "delete" = @{
            Usage       = 'git-helper delete {branch-name} [local|remote|both]'
            Description = "Remove a branch that's no longer needed. Default is local only."
            Examples    = @(
                "git-helper delete feature/old-stuff",
                "git-helper delete feature/old-stuff remote",
                "git-helper delete feature/old-stuff both"
            )
        }
        "tags" = @{
            Usage       = "git-helper tags [list|create|delete|push] [args]"
            Description = "Manage version tags - list existing, create new, or delete old ones."
            Examples    = @(
                "git-helper tags list",
                "git-helper tags create v1.0.0 `"Initial release`"",
                "git-helper tags delete v0.9.0",
                "git-helper tags push"
            )
        }
        "stash" = @{
            Usage       = "git-helper stash [list|save|pop|drop] [message]"
            Description = "Temporarily set aside changes to switch tasks, then retrieve later."
            Examples    = @(
                "git-helper stash list",
                "git-helper stash save `"parking this`"",
                "git-helper stash pop",
                "git-helper stash drop"
            )
        }
        "log" = @{
            Usage       = "git-helper log [count]"
            Description = "View commit history. Default shows last 10 commits."
            Examples    = @(
                "git-helper log",
                "git-helper log 20"
            )
        }
        "undo" = @{
            Usage       = "git-helper undo"
            Description = "Uncommit last commit but keep all file changes intact for editing."
            Examples    = @("git-helper undo")
        }
        "discard" = @{
            Usage       = "git-helper discard"
            Description = "Throw away ALL uncommitted changes. Use with extreme caution!"
            Examples    = @("git-helper discard")
        }
        "force-push" = @{
            Usage       = "git-helper force-push"
            Description = "Force-push local branch to remote, overwriting remote changes. Uses --force-with-lease for safety. Requires confirmation."
            Examples    = @("git-helper force-push")
        }
        "force-pull" = @{
            Usage       = "git-helper force-pull"
            Description = "Force-pull remote to local, discarding ALL local commits and uncommitted changes. Resets local branch to match remote exactly. Requires confirmation."
            Examples    = @("git-helper force-pull")
        }
        "private" = @{
            Usage       = 'git-helper private {sub-command} [args]'
            Description = "Manage the private config repo (.private-git/). Sub-commands: status, sync, save, push, add, log, setup."
            Examples    = @(
                "git-helper private status",
                "git-helper private sync",
                "git-helper private save `"Updated cursor rules`"",
                "git-helper private push",
                "git-helper private add .claude/settings.local.json",
                "git-helper private log",
                "git-helper private setup https://github.com/user/repo-private.git"
            )
        }
        "syncall" = @{
            Usage       = "git-helper syncall"
            Description = "Full bidirectional sync - pull then push for BOTH public and private repos. Auto-commits uncommitted changes in both repos before pushing."
            Examples    = @("git-helper syncall")
        }
    }

    if ([string]::IsNullOrEmpty($CommandName)) {
        Write-Host ""
        Write-Info "═══════════════════════════════════════════════════════════════"
        Write-Info "  GIT HELPER v2.5 - Command Reference"
        Write-Info "═══════════════════════════════════════════════════════════════"
        Write-Host ""
        Write-Colour "  Usage: " -Colour White -NoNewLine
        Write-Colour 'git-helper {command} [arguments]' -Colour Cyan
        Write-Colour "         git-helper              " -Colour White -NoNewLine
        Write-Colour "(interactive menu)" -Colour Cyan
        Write-Host ""

        Write-Info "  Public Repo"
        Write-Host ""
        $publicCmds = @(
            @{ Name = "release";   Desc = "Commit, tag, and push a new version" },
            @{ Name = "sync";      Desc = "Pull latest changes from remote" },
            @{ Name = "save";      Desc = "Commit locally (no push)" },
            @{ Name = "push";      Desc = "Push commits to remote" },
            @{ Name = "status";    Desc = "Show current state overview (public + private)" },
            @{ Name = "newbranch"; Desc = "Create and switch to new branch" },
            @{ Name = "switchto";  Desc = "Switch to existing branch" },
            @{ Name = "branches";  Desc = "List branches" },
            @{ Name = "merge";     Desc = "Merge branch into current" },
            @{ Name = "delete";    Desc = "Delete a branch" },
            @{ Name = "tags";      Desc = "Manage version tags" },
            @{ Name = "stash";     Desc = "Temporarily shelve changes" },
            @{ Name = "log";       Desc = "View commit history" },
            @{ Name = "undo";       Desc = "Uncommit (keep changes)" },
            @{ Name = "discard";    Desc = "Throw away all changes" },
            @{ Name = "force-push"; Desc = "Force local to override remote" },
            @{ Name = "force-pull"; Desc = "Force remote to override local" }
        )
        foreach ($cmd in $publicCmds) {
            Write-Colour ("    {0,-12}" -f $cmd.Name) -Colour Green -NoNewLine
            Write-Host $cmd.Desc
        }

        Write-Host ""
        Write-Info "  Private Config (.private-git/)"
        Write-Host ""
        $privateCmds = @(
            @{ Name = "private status"; Desc = "Show private config changes and recent commits" },
            @{ Name = "private sync";   Desc = "Pull latest private config from remote" },
            @{ Name = "private save";   Desc = "Stage all private files and commit" },
            @{ Name = "private push";   Desc = "Push private config commits to remote" },
            @{ Name = "private add";    Desc = "Force-stage a specific private file" },
            @{ Name = "private log";    Desc = "View private config commit history" },
            @{ Name = "private setup";       Desc = "First-time setup on a new PC" },
            @{ Name = "private force-push"; Desc = "Force local private to override remote" },
            @{ Name = "private force-pull"; Desc = "Force remote private to override local" },
            @{ Name = "syncall";            Desc = "Auto-commit + pull + push both public and private repos" }
        )
        foreach ($cmd in $privateCmds) {
            Write-Colour ("    {0,-22}" -f $cmd.Name) -Colour Magenta -NoNewLine
            Write-Host $cmd.Desc
        }

        Write-Host ""
        Write-Subtle '  For detailed help: git-helper help {command}'
        Write-Host ""

    } else {
        $cmd = $CommandName.ToLower()
        if ($helpData.ContainsKey($cmd)) {
            $help = $helpData[$cmd]
            Write-Host ""
            Write-Info "═══════════════════════════════════════════════════════════════"
            Write-Info "  $($cmd.ToUpper())"
            Write-Info "═══════════════════════════════════════════════════════════════"
            Write-Host ""
            Write-Colour "  Usage: " -Colour White -NoNewLine
            Write-Colour $help.Usage -Colour Cyan
            Write-Host ""
            Write-Host "  $($help.Description)"
            Write-Host ""
            Write-Info "  Examples:"
            foreach ($ex in $help.Examples) { Write-Subtle "    $ex" }
            Write-Host ""
        } else {
            Write-Error "Unknown command: $CommandName"
            Write-Subtle 'Use "git-helper help" to see all commands.'
        }
    }
}

#endregion

#region Interactive Menu

function Show-Menu {
    Clear-Host
    $branch = Get-CurrentBranch

    Write-Info "═══════════════════════════════════════════════════════════════"
    Write-Colour "  GIT HELPER v2.5" -Colour Cyan -NoNewLine
    Write-Colour "  📁 " -Colour White -NoNewLine
    Write-Colour $branch -Colour Green
    Write-Info "═══════════════════════════════════════════════════════════════"

    # Flash warnings for pending changes
    $publicAhead  = Get-PublicAheadCount
    $privateAhead = Get-PrivateAheadCount
    $privateDirty = Test-PrivateDirty
    $publicDirty  = -not [string]::IsNullOrEmpty((git status --porcelain 2>$null))

    $hasWarnings = ($publicAhead -gt 0) -or ($privateAhead -gt 0) -or $privateDirty -or $publicDirty
    if ($hasWarnings) {
        Write-Host ""
        if ($publicDirty)        { Write-Warning "  ⚠ Uncommitted public changes" }
        if ($publicAhead -gt 0)  { Write-Warning "  ⚠ $publicAhead unpushed public commit(s)" }
        if ($privateDirty)       { Write-Warning "  ⚠ Uncommitted private config changes" }
        if ($privateAhead -gt 0) { Write-Warning "  ⚠ $privateAhead unpushed private commit(s)" }
    }

    Write-Host ""
    Write-Subtle "  Public Repo"
    Write-Host "   1. release      Release a new version (commit, tag, push)"
    Write-Host "   2. sync         Pull latest changes from remote"
    Write-Host "   3. save         Commit changes locally (no push)"
    Write-Host "   4. push         Push commits to remote"
    Write-Host "   5. status       Overview of current state"
    Write-Host ""
    Write-Subtle "  Branch Management"
    Write-Host "   6. newbranch    Create and switch to new branch"
    Write-Host "   7. switchto     Switch to existing branch"
    Write-Host "   8. branches     List branches"
    Write-Host "   9. merge        Merge branch into current"
    Write-Host "  10. delete       Delete a branch"
    Write-Host ""
    Write-Subtle "  Utilities"
    Write-Host "  11. tags         Manage version tags"
    Write-Host "  12. stash        Temporarily shelve changes"
    Write-Host "  13. log          View commit history"
    Write-Host "  14. undo         Uncommit last (keep changes)"
    Write-Host "  15. discard      Throw away all uncommitted changes"
    Write-Host ""
    Write-Subtle "  Force Override (destructive)"
    Write-Host "  16. force-push   Force local to override remote"
    Write-Host "  17. force-pull   Force remote to override local"
    Write-Host ""
    Write-Subtle "  Private Config (.private-git/)"
    Write-Host "  18. private status       Show private config changes"
    Write-Host "  19. private sync         Pull latest private config"
    Write-Host "  20. private save         Commit private config changes"
    Write-Host "  21. private push         Push private config to remote"
    Write-Host "  22. private force-push   Force local private to override remote"
    Write-Host "  23. private force-pull   Force remote private to override local"
    Write-Host "  24. syncall              Auto-commit + pull + push BOTH repos"
    Write-Host "  25. private setup        First-time setup on a new PC"
    Write-Info "═══════════════════════════════════════════════════════════════"
    Write-Host "   0. Exit         help. Command reference"
    Write-Info "═══════════════════════════════════════════════════════════════"
    Write-Host ""
}

function Read-MenuInput {
    param([string]$Prompt)
    Write-Colour $Prompt -Colour Yellow -NoNewLine
    return Read-Host
}

function Start-InteractiveMenu {
    if (-not (Test-GitRepo)) { return }

    do {
        Show-Menu
        $selection = Read-MenuInput "  Select [0-25 or help]: "

        switch ($selection) {
            "0" { Write-Host ""; Write-Info "Goodbye!"; return }
            "help" {
                Show-Help
                Read-Host "Press Enter to continue"
            }
            "1" {
                $version = Read-MenuInput "  Enter version (e.g., v1.0.0): "
                $message = Read-MenuInput "  Enter release message: "
                Invoke-Release -Version $version -Message $message
                Read-Host "Press Enter to continue"
            }
            "2" {
                Invoke-Sync
                Read-Host "Press Enter to continue"
            }
            "3" {
                $message = Read-MenuInput "  Enter commit message: "
                Invoke-Save -Message $message
                Read-Host "Press Enter to continue"
            }
            "4" {
                Invoke-Push
                Read-Host "Press Enter to continue"
            }
            "5" {
                Invoke-Status
                Read-Host "Press Enter to continue"
            }
            "6" {
                $branchName = Read-MenuInput "  Enter new branch name: "
                Invoke-NewBranch -BranchName $branchName
                Read-Host "Press Enter to continue"
            }
            "7" {
                Write-Info "  Available branches:"
                git branch
                $branchName = Read-MenuInput "  Enter branch name to switch to: "
                Invoke-SwitchTo -BranchName $branchName
                Read-Host "Press Enter to continue"
            }
            "8" {
                $scope = Read-MenuInput "  Scope [local/remote/all] (default: local): "
                if ([string]::IsNullOrEmpty($scope)) { $scope = "local" }
                Invoke-Branches -Scope $scope
                Read-Host "Press Enter to continue"
            }
            "9" {
                Write-Info "  Available branches:"
                git branch
                $branchName = Read-MenuInput "  Enter branch name to merge: "
                Invoke-Merge -BranchName $branchName
                Read-Host "Press Enter to continue"
            }
            "10" {
                Write-Info "  Available branches:"
                git branch -a
                $branchName = Read-MenuInput "  Enter branch name to delete: "
                $scope      = Read-MenuInput "  Scope [local/remote/both] (default: local): "
                if ([string]::IsNullOrEmpty($scope)) { $scope = "local" }
                Invoke-Delete -BranchName $branchName -Scope $scope
                Read-Host "Press Enter to continue"
            }
            "11" {
                Write-Host ""
                Write-Subtle "  Tag options: list, create, delete, push"
                $action = Read-MenuInput "  Action (default: list): "
                if ([string]::IsNullOrEmpty($action)) { $action = "list" }
                switch ($action.ToLower()) {
                    "create" {
                        $tagName    = Read-MenuInput "  Tag name (e.g., v1.0.0): "
                        $tagMessage = Read-MenuInput "  Tag message: "
                        Invoke-Tags -Action $action -TagName $tagName -Message $tagMessage
                    }
                    "delete" {
                        Invoke-Tags -Action "list"
                        $tagName = Read-MenuInput "  Tag name to delete: "
                        Invoke-Tags -Action $action -TagName $tagName
                    }
                    default { Invoke-Tags -Action $action }
                }
                Read-Host "Press Enter to continue"
            }
            "12" {
                Write-Host ""
                Write-Subtle "  Stash options: list, save, pop, drop"
                $action = Read-MenuInput "  Action (default: list): "
                if ([string]::IsNullOrEmpty($action)) { $action = "list" }
                if ($action.ToLower() -eq "save") {
                    $message = Read-MenuInput "  Stash message (optional): "
                    Invoke-Stash -Action $action -Message $message
                } else {
                    Invoke-Stash -Action $action
                }
                Read-Host "Press Enter to continue"
            }
            "13" {
                $count = Read-MenuInput "  Number of commits to show (default: 10): "
                if ([string]::IsNullOrEmpty($count)) { $count = 10 }
                Invoke-Log -Count ([int]$count)
                Read-Host "Press Enter to continue"
            }
            "14" {
                Invoke-Undo
                Read-Host "Press Enter to continue"
            }
            "15" {
                Invoke-Discard
                Read-Host "Press Enter to continue"
            }
            "16" {
                Invoke-ForcePush
                Read-Host "Press Enter to continue"
            }
            "17" {
                Invoke-ForcePull
                Read-Host "Press Enter to continue"
            }
            "18" {
                Invoke-PrivateStatus
                Read-Host "Press Enter to continue"
            }
            "19" {
                Invoke-PrivateSync
                Read-Host "Press Enter to continue"
            }
            "20" {
                $message = Read-MenuInput "  Enter commit message: "
                Invoke-PrivateSave -Message $message
                Read-Host "Press Enter to continue"
            }
            "21" {
                Invoke-PrivatePush
                Read-Host "Press Enter to continue"
            }
            "22" {
                Invoke-PrivateForcePush
                Read-Host "Press Enter to continue"
            }
            "23" {
                Invoke-PrivateForcePull
                Read-Host "Press Enter to continue"
            }
            "24" {
                Invoke-SyncAll
                Read-Host "Press Enter to continue"
            }
            "25" {
                $url = Read-MenuInput "  Private repo URL (leave blank to auto-derive): "
                Invoke-PrivateSetup -Url $url
                Read-Host "Press Enter to continue"
            }
            default {
                if (-not [string]::IsNullOrEmpty($selection)) {
                    Write-Error "  Invalid selection: $selection"
                    Start-Sleep -Seconds 1
                }
            }
        }
    } while ($true)
}

#endregion

#region Main Entry Point

if ([string]::IsNullOrEmpty($Command)) {
    Start-InteractiveMenu
    exit
}

$noRepoCommands = @("help")
if ($Command.ToLower() -notin $noRepoCommands) {
    if (-not (Test-GitRepo)) { exit 1 }
}

switch ($Command.ToLower()) {
    "help"      { Show-Help -CommandName $Arg1 }
    "release"   { Invoke-Release -Version $Arg1 -Message $Arg2 }
    "sync"      { Invoke-Sync }
    "save"      { Invoke-Save -Message $Arg1 }
    "push"      { Invoke-Push }
    "status"    { Invoke-Status }
    "newbranch" { Invoke-NewBranch -BranchName $Arg1 }
    "switchto"  { Invoke-SwitchTo -BranchName $Arg1 }
    "branches"  { Invoke-Branches -Scope $(if ($Arg1) { $Arg1 } else { "local" }) }
    "merge"     { Invoke-Merge -BranchName $Arg1 }
    "delete"    { Invoke-Delete -BranchName $Arg1 -Scope $(if ($Arg2) { $Arg2 } else { "local" }) }
    "tags"      { Invoke-Tags  -Action $(if ($Arg1) { $Arg1 } else { "list" }) -TagName $Arg2 -Message $Arg3 }
    "stash"     { Invoke-Stash -Action $(if ($Arg1) { $Arg1 } else { "list" }) -Message $Arg2 }
    "log"       { Invoke-Log   -Count  $(if ($Arg1) { [int]$Arg1 } else { 10 }) }
    "undo"      { Invoke-Undo }
    "discard"    { Invoke-Discard }
    "force-push" { Invoke-ForcePush }
    "force-pull" { Invoke-ForcePull }
    "private"    { Invoke-Private -SubCommand $Arg1 -SubArg1 $Arg2 -SubArg2 $Arg3 }
    "syncall"   { Invoke-SyncAll }
    default {
        Write-Error "Unknown command: $Command"
        Write-Subtle 'Use "git-helper help" to see all commands.'
        exit 1
    }
}

#endregion
