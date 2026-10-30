# Upload, create, preview, move and copy files

Open a session's **Dashboard → Files** to work with that session's files, or
**Dashboard → Project files** for files every session of the project shares.
Both pages use the same controls: choose an area, open folders from the list or
the breadcrumb, and open a file to read or edit it.

## The file areas

| Area | Where | What it holds | How long files stay |
| --- | --- | --- | --- |
| **Repo** | Files | The session's source | Until changed; publish with **Save work** |
| **Session Dropzone** | Files | Files exchanged with this session's coding agent, outside Git | Deleted when the session is archived |
| **Session** | Files (workspace owner only) | The session's runtime files, read only | With the session |
| **Project Dropzone** | Project files | Files shared by every session of the project, outside Git | Until someone deletes them |
| **Project Backups** | Project files | Temporary backups shared by every session | Each file is deleted 2 weeks after its last change |

Each area shows a one-line description under its toolbar. Access follows the
signed-in account; changing a link cannot select another role. **Project files**
is in the Dashboard's **Project** group, so it works with no session selected.

## Upload files

In Session Dropzone, Project Dropzone or Project Backups, open the folder you
want and choose **Upload**, or drag files from your computer onto the area.
Files go straight into the folder that was open when you added them; there is
no separate holding step. You can add up to 200 files at a time, each up to
500 MiB. To send a folder, upload a zip of it: dropping a folder is refused.

While files upload, an **Uploads** card stays at the bottom of the area:

- the header shows how many files are left, the bytes sent of the total and the
  overall percentage, with a progress bar;
- each file shows **Waiting**, its bytes and percentage while it uploads,
  **Finishing**, **Uploaded**, **Cancelled** or the reason it failed;
- the cross beside an unfinished file cancels it, and **Cancel all** cancels
  everything still waiting or uploading. A cancelled file leaves nothing behind;
- a failed file offers **Try again** and **Remove from the list**;
- the arrow hides or shows the list, and the close button clears the finished
  card.

Files upload one at a time, in the order you added them. Keep the browser tab
open until the card says they are uploaded; closing or reloading it stops the
files not yet finished. Each file appears in the folder as soon as it is
complete; nobody sees a half-uploaded file.

Repo has no **Upload** button. Upload into a Dropzone, then use **Move or copy…**
to put the file into the source (see below), or ask the coding agent.

## When a name already exists

Before uploading, moving or copying, Files checks the destination folder. If
something with the same name is there, it asks once for the whole batch:

- **Replace** overwrites the item that is there;
- **Keep both** gives the new item the next free name, such as `report (1).pdf`;
- **Skip** leaves the existing item and does the rest;
- **Cancel** does nothing.

Nothing is ever overwritten without that choice.

## Create and edit text files

Choose **New file** (on a phone: the **More folder actions** menu), type a name
without slashes and, if you like, its first contents, then choose **Create**. The
file is created in the open folder and opens straight away. Opening a text file
lets you edit it: **Save** (or Ctrl+S, ⌘S on a Mac) keeps the change and
**Discard** drops it. **Back to folder** waits until you have saved or discarded. **New
folder** creates an empty folder in the open folder. Use an item's **⋮** menu for
**Rename** or **Delete**; confirm **Delete** to remove a file or a whole folder.

In Repo, use **New file here** in a folder's **⋮** menu, or **New file at source
root**.
Repo changes are session changes like any edit; publish them with **Save work**.
The Session area is read only: you can open, download and copy from it, but not
create, edit, rename, move or delete.

## Preview images

Opening a `png`, `jpg`/`jpeg`, `gif`, `webp`, `avif`, `bmp`, `ico` or `svg` file
shows the image right in the Files pane, in every area including Repo:

- it fits the pane at first; choose **Actual size** (or click the image) to see it
  at full size and scroll around, and **Fit to window** to fit it again;
- the file bar shows its name, and the caption its width × height in pixels and
  its size;
- if an image cannot load, **Try again** retries it.

Outside Repo, **Download**, **Move or copy…** and **Delete** (where the area is
writable) are in the file bar, which wraps below the name on a phone.
**Previous image** and **Next image** (or the ← and → keys) step through the
images in the same folder, and **Esc** goes back to the folder. In Repo, the
editor's own toolbar keeps **Download**, and the file tree's **⋮** menu has
**Move or copy…**.

SVG files are shown as pictures only; their markup never runs in the page. In
Repo an SVG also has a toggle to switch between the picture and its source text.

## Move or copy files

Open an item's **⋮** menu (outside Repo, also the file bar when the file is
open) and choose **Move or copy…**. In the dialog:

1. choose **Copy** or **Move** at the top (a read-only Session item opens
   **Copy to**, which only copies);
2. choose the destination area chip;
3. open the destination folder in the list, using the breadcrumb to go back up;
4. choose **Copy here** or **Move here**.

The dialog shows **Into** and the destination it will use. It moves or copies a
file or a whole folder on the server, so nothing is downloaded to your computer
first. From Files, the destinations are Repo, Session Dropzone, Project Dropzone
and Project Backups. From Project files, they are Project Dropzone and Project
Backups, plus the Repo and Session Dropzone of the session open beside the
Dashboard, labelled with that session's name; with no session open, only the
project areas are offered.

Some moves are not allowed:

- the Session area offers **Copy to…** only; it is never a destination;
- an archived session can only copy from its Session area to the project areas;
- a folder cannot go inside itself, and an item cannot move into the folder it
  is already in;
- Repo refuses `.git` and the project's root `.vibe64` folder, and every area
  refuses links and special files.

After a move or copy a message says what happened, for example "Moved
“report.pdf” to Project Backups › 2026." or, if you chose **Keep both**, the new
name. A copy into Repo is a session change; review it in **Current changes** and
publish it with **Save work**. If an area is busy, for example while another
source change is starting in Repo or Project Backups maintenance is running,
Files says so and changes nothing; wait a moment and try again. A copy that fails part
way leaves nothing at the destination, and a move only removes the original
after its copy is complete.

## Project Dropzone and Project Backups

**Project Dropzone** is the place to keep files every session should be able to
use, such as briefs, data samples or design exports. Files stay until someone
deletes them. Switching, renewing or archiving a session does not touch it, and
deleting the project keeps it in the project's archive.

**Project Backups** holds temporary safety copies. Every file shows **Deleted
after** and a date. Daily maintenance deletes each file 2 weeks after it was
last written or changed; a newly copied or moved file starts a fresh 2 weeks even
if it keeps an older modification date. Download, or copy to Project Dropzone,
anything you want to keep. This folder does not snapshot your project
automatically. Workspace upgrade recovery copies are kept separately and do not
appear here. Symbolic links are not shown or cleaned automatically.

**Session Dropzone** belongs to one session and disappears when that session is
successfully archived. Copy anything you need into Project Dropzone first.

## Use files with the coding agent

The coding agent finds the same folders through `VIBE64_DROP_ZONE` (Session
Dropzone), `VIBE64_PROJECT_DROP_ZONE` (Project Dropzone) and
`VIBE64_PROJECT_BACKUPS` (Project Backups). **Copy AI path** copies the open
folder's path so you can paste it into a message, for example "Read the CSV in
<path> and import it". Files refreshes the open folder when the agent finishes
a turn; **Refresh** reloads it at any time.

## On a phone

The areas fill the width as tabs. **Upload** stays in the toolbar and the other
folder actions are in **More folder actions**. Each item's **⋮** menu has
**Download**, **Move or copy…**, **Rename** and **Delete**. Opening a file fills
the pane; **Back to folder** returns. The move or copy and new file dialogs open
full screen, with **Close** and their action (**Copy here**, **Move here** or
**Create**) at the top so the keyboard never hides them.

## What Colleague can do

Colleague can explain all of this and open **Files** for a session or **Project
files** for the project in your browser; ask "Open Project files". It cannot
choose files from your computer, upload, move, copy or read file contents itself.
Ask the coding agent to create, inspect or tidy files, or do it with the controls
above.
