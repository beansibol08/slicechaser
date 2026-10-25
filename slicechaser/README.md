# SliceChaser

Screen bumps and slice chases for Resolume Arena, built from your Advanced Output setup.

It has two parts that talk through one file:

- **The editor** (desktop app, Windows and Mac) reads your Advanced Output slices. You build sequences by clicking slices on and off per step, or generate them (left to right, center out, random and more). Every change saves straight away.
- **Two FFGL effects for Resolume**:
  - **SliceChaser** plays a sequence as you animate its Step parameter.
  - **SliceBumper** steps through a sequence each time you tap Next.

Both effects watch the file, so edits in the editor show up in Resolume while it runs.

```
Arena Advanced Output ──► editor ──► Documents/SliceChaser/chases.json ──► SliceChaser / SliceBumper in Resolume
```

## Get the builds

You don't need a compiler. GitHub builds everything:

1. Create a repository on GitHub and push this folder to it.
2. Open the **Actions** tab. The **Build** workflow runs on every push.
3. When it finishes (about 10 minutes), open the run and download the artifacts:
   - `plugins-windows`: `SliceChaser.dll`, `SliceBumper.dll`
   - `plugins-macos`: `SliceChaser.bundle.zip`, `SliceBumper.bundle.zip` (universal: Apple Silicon and Intel)
   - `editor-Windows`: installer and portable `.exe`
   - `editor-macOS`: `.dmg`

To get a downloadable release instead, push a tag: `git tag v1.0.0 && git push --tags`.

## Install

**Plugins.** Copy them into Resolume's effects folder, by default `Documents/Resolume Arena/Extra Effects`. You can also add any folder under Arena's **Preferences → Video**. Then restart Arena; the effects appear under Effects as SliceChaser and SliceBumper.

On Mac, unzip the bundles first. Builds aren't notarized, so clear the download quarantine or Arena may refuse to load them:

```
xattr -dr com.apple.quarantine ~/Documents/Resolume\ Arena/Extra\ Effects/SliceChaser.bundle ~/Documents/Resolume\ Arena/Extra\ Effects/SliceBumper.bundle
```

**Editor.** On Windows, run the installer, or the portable `.exe`. SmartScreen will warn because it is unsigned; choose More info, then Run anyway. On Mac, open the `.dmg` and drag SliceChaser to Applications. The first time, right-click the app and choose Open.

Arena 7.4.1 or later is needed. That is the version where plugins can update their own buttons, which is how new sequences appear without restarting.

## Use it

1. **Set up slices** in Arena's Advanced Output as usual. Arena saves the setup to `Documents/Resolume Arena/Preferences/AdvancedOutput.xml` when you close the Advanced Output window, and presets go to `Presets/Advanced Output`.
2. **Open the editor.** It picks up Arena's current setup automatically; the **Slices from** menu lists your presets too. If you change slices in Arena, the editor reloads by itself when Arena saves.
3. **Make sequences.**
   - Pick a pattern under **Generate** and click **Create sequence**. "Light aligned slices together" puts slices in the same column or row into one step.
   - Or click **New** and paint: click a slice to toggle it in the current step, drag across slices to paint several, and use **Add step** (or `N`) for the next step.
   - Press **Play** to preview. Set BPM and Beats per loop to match what you'll use in Resolume.
4. **In Resolume**, add **SliceChaser** to a layer or clip. Pick your sequence under **Sequence**, then animate **Step**: right-click it and choose BPM Sync, with the number of beats one loop should take. Any automation works, including Timeline and FFT.

Keyboard shortcuts in the editor:

| Key | Action |
| --- | --- |
| `←` `→` | Previous / next step |
| `N` | Add a step after the current one |
| `Delete` | Delete the current step |
| `Ctrl/Cmd+D` | Duplicate the current step |
| `Space` | Play / stop the preview |
| `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z` | Undo, redo |

## Effect parameters

**SliceChaser**

| Parameter | What it does |
| --- | --- |
| Sequence | Which sequence plays. Renaming or reordering sequences in the editor keeps the same one selected. |
| Scaling | **Fill** fits your content into each slice, keeping its shape and cropping the excess (rotated slices are handled). **Mask** leaves content in place and only cuts out the lit slices. **Stretch** squashes content into each slice. |
| Step | Position in the sequence, 0 to 1 across all steps. Animate this. |
| Echoes | Keeps each step lit for this many steps, fading across all of them. |
| Sustain, Release | Fade within a step. The slice is fully on until Sustain, fades to off by Release, and stays off after that. Set both to 1 for hard cuts. |
| Reverse | Plays the sequence backwards. |

**SliceBumper**

| Parameter | What it does |
| --- | --- |
| Sequence, Scaling, Sustain, Release | As above. |
| Next, Previous | Tap to light the next or previous step. Map them to MIDI or keys to play along. |
| Blast | Runs through the whole sequence once, fast. Blast Speed sets how fast. |
| Fade Speed | How quickly a tapped step fades out (higher is faster). |
| Auto Reset, Reset Delay | After this many seconds without a tap, the next tap starts from step 1 again. |

Outside the lit slices the effects output transparency. Put them on a layer above your background, or use them as a mask.

## Good to know

- Resolume's file format for polygon slices isn't publicly documented. The editor reads a polygon's contour points when it finds them and otherwise uses the polygon's bounding rectangle. If a polygon slice looks wrong, check it against the editor canvas; the slice list also reports any slice it couldn't read.
- If you copy `chases.json` to another computer, the effects work without the editor.
- The file lives at `Documents/SliceChaser/chases.json`; **Show file** in the editor opens its folder. Set the `SLICECHASER_FILE` environment variable to use a different path for both apps.

## Build it yourself

Plugins need CMake 3.20 and Visual Studio 2019+ (Windows) or Xcode (Mac). The FFGL SDK is downloaded automatically:

```
cmake -S plugin -B build
cmake --build build --config Release
```

The output is `build/out/SliceChaser.dll` (or `.bundle`) and `SliceBumper`.

The editor needs Node.js 20+:

```
cd editor
npm install
npm start          # run it
npm run dist       # build the installer for this OS
```

Tests: `ctest --test-dir build` for the plugin logic; `npm test` and `npm run test:ui` for the editor. Add `-DSLICECHASER_GL_TEST=ON` on Linux with Mesa to also run the plugin binaries in a headless OpenGL host and check their pixels.

## Project layout

```
plugin/
  src/ChaseData.*       chase file loader, hot reload, timing maths (no OpenGL)
  src/SliceRenderer.*   draws slices with per-slice opacity
  src/ChaseEffect.*     shared Sequence/Scaling parameters, live sequence list
  src/ChaserFX.cpp      SliceChaser
  src/BumperFX.cpp      SliceBumper
  tests/                unit tests and the headless OpenGL host
editor/
  main.js, preload.js   Electron shell (file access)
  renderer/             the editor page; lib/ holds the parser, geometry, patterns, file format
  tests/                library tests and the Chromium UI test
```

SliceChaser is an independent project inspired by [Chaser by Hybrid Constructs](https://hybridconstructs.com/chaser/), which offers a much larger plugin suite. It uses Resolume's [FFGL SDK](https://github.com/resolume/ffgl).
