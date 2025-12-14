<#
.SYNOPSIS
    Git Helper - A user-friendly PowerShell script for common Git operations.

.DESCRIPTION
    Run without arguments for an interactive menu, or pass commands directly for quick execution.

    Usage:
        git-helper                      # Interactive menu
        git-helper <command> [args]     # Direct execution
        git-helper help                 # Show all commands
        git-helper help <command>       # Show help for specific command

.EXAMPLE
    git-helper release v1.2.0 "Bug fixes"
    git-helper sync
    git-helper save "WIP: refactoring"

.NOTES
    Author: Max Soukhomlinov
    Version: 1.0.0
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
function Write-Error { param([string]$Text) Write-Colour $Text -Colour Red }
function Write-Warning { param([string]$Text) Write-Colour $Text -Colour Yellow }
function Write-Info { param([string]$Text) Write-Colour $Text -Colour Cyan }
function Write-Subtle { param([string]$Text) Write-Colour $Text -Colour DarkGray }

function Get-CurrentBranch {
    $branch = git branch --show-current 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($branch)) {
        return "not a git repo"
    }
    return $branch
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
    param(
        [string]$Message,
        [string]$DefaultNo = "N"
    )
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

#endregion

#region Command Implementations

function Invoke-Release {
    param([string]$Version, [string]$Message)

    if ([string]::IsNullOrEmpty($Version) -or [string]::IsNullOrEmpty($Message)) {
        Write-Error "Usage: git-helper release <version> <message>"
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
    git push origin $branch --tags

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Success "✓ Released $Version successfully!"
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
        Write-Error "Usage: git-helper save <message>"
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

function Invoke-Push {
    Show-CommandHeader "PUSH"

    $branch = Get-CurrentBranch
    Write-Info "Pushing $branch to remote..."
    git push origin $branch

    if ($LASTEXITCODE -eq 0) {
        Write-Success "✓ Pushed to origin/$branch successfully."
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

    Write-Info "─── File Status ───"
    git status --short

    $changes = git status --porcelain
    if ([string]::IsNullOrEmpty($changes)) {
        Write-Subtle "  (no uncommitted changes)"
    }

    Write-Host ""
    Write-Info "─── Recent Commits ───"
    git log --oneline -5
    Write-Host ""
}

function Invoke-NewBranch {
    param([string]$BranchName)

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error "Usage: git-helper newbranch <branch-name>"
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
        Write-Error "Usage: git-helper switchto <branch-name>"
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
        "local" {
            Write-Info "Local branches:"
            git branch
        }
        "remote" {
            Write-Info "Remote branches:"
            git branch -r
        }
        "all" {
            Write-Info "All branches (local and remote):"
            git branch -a
        }
        default {
            Write-Warning "Unknown scope: $Scope"
            Write-Subtle "Options: local, remote, all"
        }
    }
}

function Invoke-Merge {
    param([string]$BranchName)

    if ([string]::IsNullOrEmpty($BranchName)) {
        Write-Error "Usage: git-helper merge <branch-name>"
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
        Write-Error "Usage: git-helper delete <branch-name> [local|remote|both]"
        Write-Subtle "Example: git-helper delete feature/old-stuff remote"
        return
    }

    Show-CommandHeader "DELETE BRANCH: $BranchName"

    if (-not (Get-Confirmation "This will delete branch '$BranchName' ($Scope). This cannot be undone easily.")) {
        Write-Warning "Cancelled."
        return
    }

    switch ($Scope.ToLower()) {
        "local" {
            Write-Info "Deleting local branch..."
            git branch -d $BranchName
        }
        "remote" {
            Write-Info "Deleting remote branch..."
            git push origin --delete $BranchName
        }
        "both" {
            Write-Info "Deleting local branch..."
            git branch -d $BranchName
            Write-Info "Deleting remote branch..."
            git push origin --delete $BranchName
        }
        default {
            Write-Warning "Unknown scope: $Scope. Use: local, remote, both"
            return
        }
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
            if ([string]::IsNullOrEmpty($tags)) {
                Write-Subtle "  (no tags found)"
            } else {
                git tag --sort=-creatordate
            }
        }
        "create" {
            if ([string]::IsNullOrEmpty($TagName)) {
                Write-Error "Usage: git-helper tags create <tag-name> <message>"
                Write-Subtle "Example: git-helper tags create v1.0.0 `"Initial release`""
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
                Write-Error "Usage: git-helper tags delete <tag-name>"
                return
            }

            if (-not (Get-Confirmation "Delete tag '$TagName'?")) {
                Write-Warning "Cancelled."
                return
            }

            Write-Info "Deleting local tag..."
            git tag -d $TagName
            Write-Info "Deleting remote tag..."
            git push origin --delete $TagName

            Write-Success "✓ Tag '$TagName' deleted."
        }
        "push" {
            Write-Info "Pushing all tags to remote..."
            git push --tags

            if ($LASTEXITCODE -eq 0) {
                Write-Success "✓ Tags pushed to remote."
            }
        }
        default {
            Write-Warning "Unknown action: $Action"
            Write-Subtle "Options: list, create, delete, push"
        }
    }
}

function Invoke-Stash {
    param([string]$Action = "list", [string]$Message)

    Show-CommandHeader "STASH"

    switch ($Action.ToLower()) {
        "list" {
            Write-Info "Stashed changes:"
            $stashes = git stash list
            if ([string]::IsNullOrEmpty($stashes)) {
                Write-Subtle "  (no stashes found)"
            } else {
                git stash list
            }
        }
        "save" {
            if ([string]::IsNullOrEmpty($Message)) {
                $Message = "WIP: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
            }
            Write-Info "Stashing changes: $Message..."
            git stash push -m $Message

            if ($LASTEXITCODE -eq 0) {
                Write-Success "✓ Changes stashed. Use 'stash pop' to retrieve them."
            }
        }
        "pop" {
            Write-Info "Retrieving most recent stash..."
            git stash pop

            if ($LASTEXITCODE -eq 0) {
                Write-Success "✓ Stash applied and removed from stash list."
            } else {
                Write-Error "✗ Failed to pop stash. You may have conflicts."
            }
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
        default {
            Write-Warning "Unknown action: $Action"
            Write-Subtle "Options: list, save, pop, drop"
        }
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

    if (-not (Get-Confirmation "Undo the last commit?")) {
        Write-Warning "Cancelled."
        return
    }

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

#endregion

#region Help System

function Show-Help {
    param([string]$CommandName)

    $helpData = @{
        "release" = @{
            Usage = "git-helper release <version> <message>"
            Description = "When you're ready to publish a new version - bundles changes, creates version tag, and pushes everything."
            Examples = @(
                "git-helper release v1.0.0 `"Initial release`"",
                "git-helper release v1.2.1 `"Fixed login bug`""
            )
        }
        "sync" = @{
            Usage = "git-helper sync"
            Description = "Updates your local copy with all changes from remote. Do this before starting new work."
            Examples = @("git-helper sync")
        }
        "save" = @{
            Usage = "git-helper save <message>"
            Description = "Checkpoint your work locally without pushing. Like hitting 'save' on a document."
            Examples = @(
                "git-helper save `"WIP: auth refactor`"",
                "git-helper save `"Added validation`""
            )
        }
        "push" = @{
            Usage = "git-helper push"
            Description = "Upload your committed changes to remote so others can see them."
            Examples = @("git-helper push")
        }
        "status" = @{
            Usage = "git-helper status"
            Description = "Quick overview - current branch, changed files, and recent commits."
            Examples = @("git-helper status")
        }
        "newbranch" = @{
            Usage = "git-helper newbranch <branch-name>"
            Description = "Start work on a new feature/fix in isolation from main code."
            Examples = @(
                "git-helper newbranch feature/login",
                "git-helper newbranch bugfix/header-crash"
            )
        }
        "switchto" = @{
            Usage = "git-helper switchto <branch-name>"
            Description = "Move to a different branch to work on something else."
            Examples = @(
                "git-helper switchto main",
                "git-helper switchto feature/login"
            )
        }
        "branches" = @{
            Usage = "git-helper branches [local|remote|all]"
            Description = "See what branches exist. Default shows local branches only."
            Examples = @(
                "git-helper branches",
                "git-helper branches all",
                "git-helper branches remote"
            )
        }
        "merge" = @{
            Usage = "git-helper merge <branch-name>"
            Description = "Combine another branch's changes into your current branch."
            Examples = @("git-helper merge feature/login")
        }
        "delete" = @{
            Usage = "git-helper delete <branch-name> [local|remote|both]"
            Description = "Remove a branch that's no longer needed. Default is local only."
            Examples = @(
                "git-helper delete feature/old-stuff",
                "git-helper delete feature/old-stuff remote",
                "git-helper delete feature/old-stuff both"
            )
        }
        "tags" = @{
            Usage = "git-helper tags [list|create|delete|push] [args]"
            Description = "Manage version tags - list existing, create new, or delete old ones."
            Examples = @(
                "git-helper tags list",
                "git-helper tags create v1.0.0 `"Initial release`"",
                "git-helper tags delete v0.9.0",
                "git-helper tags push"
            )
        }
        "stash" = @{
            Usage = "git-helper stash [list|save|pop|drop] [message]"
            Description = "Temporarily set aside changes to switch tasks, then retrieve later."
            Examples = @(
                "git-helper stash list",
                "git-helper stash save `"parking this`"",
                "git-helper stash pop",
                "git-helper stash drop"
            )
        }
        "log" = @{
            Usage = "git-helper log [count]"
            Description = "View commit history. Default shows last 10 commits."
            Examples = @(
                "git-helper log",
                "git-helper log 20"
            )
        }
        "undo" = @{
            Usage = "git-helper undo"
            Description = "Uncommit last commit but keep all file changes intact for editing."
            Examples = @("git-helper undo")
        }
        "discard" = @{
            Usage = "git-helper discard"
            Description = "Throw away ALL uncommitted changes. Use with extreme caution!"
            Examples = @("git-helper discard")
        }
    }

    if ([string]::IsNullOrEmpty($CommandName)) {
        # Show all commands
        Write-Host ""
        Write-Info "═══════════════════════════════════════════════════════════════"
        Write-Info "  GIT HELPER - Command Reference"
        Write-Info "═══════════════════════════════════════════════════════════════"
        Write-Host ""
        Write-Colour "  Usage: " -Colour White -NoNewLine
        Write-Colour "git-helper <command> [arguments]" -Colour Cyan
        Write-Colour "         git-helper              " -Colour White -NoNewLine
        Write-Colour "(interactive menu)" -Colour Cyan
        Write-Host ""
        Write-Info "  Commands:"
        Write-Host ""

        $commands = @(
            @{ Name = "release"; Desc = "Commit, tag, and push a new version" },
            @{ Name = "sync"; Desc = "Pull latest changes from remote" },
            @{ Name = "save"; Desc = "Commit locally (no push)" },
            @{ Name = "push"; Desc = "Push commits to remote" },
            @{ Name = "status"; Desc = "Show current state overview" },
            @{ Name = "newbranch"; Desc = "Create and switch to new branch" },
            @{ Name = "switchto"; Desc = "Switch to existing branch" },
            @{ Name = "branches"; Desc = "List branches" },
            @{ Name = "merge"; Desc = "Merge branch into current" },
            @{ Name = "delete"; Desc = "Delete a branch" },
            @{ Name = "tags"; Desc = "Manage version tags" },
            @{ Name = "stash"; Desc = "Temporarily shelve changes" },
            @{ Name = "log"; Desc = "View commit history" },
            @{ Name = "undo"; Desc = "Uncommit (keep changes)" },
            @{ Name = "discard"; Desc = "Throw away all changes" }
        )

        foreach ($cmd in $commands) {
            Write-Colour ("    {0,-12}" -f $cmd.Name) -Colour Green -NoNewLine
            Write-Host $cmd.Desc
        }

        Write-Host ""
        Write-Subtle "  For detailed help: git-helper help <command>"
        Write-Host ""

    } else {
        # Show specific command help
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
            foreach ($ex in $help.Examples) {
                Write-Subtle "    $ex"
            }
            Write-Host ""
        } else {
            Write-Error "Unknown command: $CommandName"
            Write-Subtle "Use 'git-helper help' to see all commands."
        }
    }
}

#endregion

#region Interactive Menu

function Show-Menu {
    Clear-Host
    $branch = Get-CurrentBranch

    Write-Info "═══════════════════════════════════════════════════════════════"
    Write-Colour "  GIT HELPER                              " -Colour Cyan -NoNewLine
    Write-Colour "📁 " -Colour White -NoNewLine
    Write-Colour $branch -Colour Green
    Write-Info "═══════════════════════════════════════════════════════════════"
    Write-Host ""
    Write-Subtle "  Core Workflow"
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
        $selection = Read-MenuInput "  Select [0-15 or help]: "

        switch ($selection) {
            "0" {
                Write-Host ""
                Write-Info "Goodbye!"
                return
            }
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
                $scope = Read-MenuInput "  Scope [local/remote/both] (default: local): "
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
                        $tagName = Read-MenuInput "  Tag name (e.g., v1.0.0): "
                        $tagMessage = Read-MenuInput "  Tag message: "
                        Invoke-Tags -Action $action -TagName $tagName -Message $tagMessage
                    }
                    "delete" {
                        Invoke-Tags -Action "list"
                        $tagName = Read-MenuInput "  Tag name to delete: "
                        Invoke-Tags -Action $action -TagName $tagName
                    }
                    default {
                        Invoke-Tags -Action $action
                    }
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

# If no arguments, show interactive menu
if ([string]::IsNullOrEmpty($Command)) {
    Start-InteractiveMenu
    exit
}

# Verify we're in a git repo for commands that need it
$noRepoCommands = @("help")
if ($Command.ToLower() -notin $noRepoCommands) {
    if (-not (Test-GitRepo)) { exit 1 }
}

# Direct command execution
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
    "tags"      { Invoke-Tags -Action $(if ($Arg1) { $Arg1 } else { "list" }) -TagName $Arg2 -Message $Arg3 }
    "stash"     { Invoke-Stash -Action $(if ($Arg1) { $Arg1 } else { "list" }) -Message $Arg2 }
    "log"       { Invoke-Log -Count $(if ($Arg1) { [int]$Arg1 } else { 10 }) }
    "undo"      { Invoke-Undo }
    "discard"   { Invoke-Discard }
    default {
        Write-Error "Unknown command: $Command"
        Write-Subtle "Use 'git-helper help' to see all commands."
        exit 1
    }
}

#endregion
