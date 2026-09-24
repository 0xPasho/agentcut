# Documentation screenshots

Browser screenshots of the running application at 1600 × 1000, device pixel ratio 2,
scaled to 2400 px wide. They are captures, not mockups.

- `editor.png`: the editor on a clip the agent cut out of a stream recording, with the
  agent's steps on the right.
- `clips.png`: a clipping project, the ranked clips and the selected clip's preview.
- `home.png`: the home screen, cropped to the composer.
- `asset-preview.png`: the asset gallery and its floating source preview (2026-09-16,
  illustrated demo media).

The 2026-09-24 captures show the owner's own stream footage and channel end card; no
third-party stock media or credentials appear. To retake them, run the app and:

```sh
node scripts/screenshot.mjs "http://localhost:3000/p/<project>/c/<sequence>" docs/images/editor.png
```

(`scripts/screenshot.mjs` drives Remotion's headless Chrome over CDP; media the server
answers 404 for renders black, so pick a project whose sources it can read.)
