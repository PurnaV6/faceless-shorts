# Productions

One folder per video, created by `/yt-studio`. Every agent reads the files
before its stage and writes only its own.

```
productions/<slug>/
  status.json         stage, approvals and who approved what, when
  01-ideas.md         brain: the pitched ideas
  02-script.md        brain: outline + full script for the approved idea
  03-review.md        writer: proposed changes (applied to 02-script.md only after approval)
  04-seo.md           seo: verdict, target queries, PASS or FAIL with reasons
  scenes.json         creator: the render spec (format below)
  assets/             creator: voice previews, Higgsfield backgrounds
  render/             renderer output; render/final.mp4 is the video
  05-qa.md            render-qa: duration, sync, visual checks, PASS or FAIL
  06-advice.md        advisor: what to change before publishing
  07-package.md       packager: titles, description, tags, thumbnail brief
  thumbnail.png       packager: the approved thumbnail (1280x720)
  publish.json        packager: title, description, tags, publishAt; written only after approval
```

Render with:

```bash
npm run render:longform -- productions/<slug>
```

## scenes.json

```json
{
  "title": "The Night Shift at Pine Hollow",
  "voice": {
    "voiceId": "e5WNhrdI30aXpS2RSGm1",
    "name": "Ian Cartwell",
    "stability": 0.4,
    "similarity": 0.8,
    "style": 0.35
  },
  "captions": true,
  "scenes": [
    {
      "id": "s01",
      "narration": "The ad said night clerk, eleven to seven, no experience needed.",
      "background": { "preset": "street" },
      "effects": ["grain", "flicker"],
      "camera": { "zoomFrom": 1.0, "zoomTo": 1.08 },
      "characters": [
        { "id": "me", "kind": "stickman", "pose": "walk", "x": [0.15, 0.55], "facing": "right", "prop": "phone" }
      ]
    }
  ]
}
```

Scene fields:

- `narration` (required): the exact words for this scene. Each scene is voiced
  separately, so the scene lasts as long as its narration plus `padSeconds`
  (default 0.6). Keep each one under 900 characters.
- `background`: `{ "preset": name }` or `{ "image": "assets/file.png" }`.
  Presets: `black`, `street`, `forest`, `hallway`, `bedroom`, `basement`,
  `field`, `house`, `store`. Images are darkened and slowly panned.
- `effects`: any of `grain`, `flicker`, `fog`, `rain`, `shake`, `fade_in`,
  `fade_out`. A vignette is always on.
- `camera`: `zoomFrom`/`zoomTo`, default 1.0 to 1.05.
- `characters`: up to 4.
  - `kind`: `stickman` (white figure) or `shadow` (tall dark figure with pale
    eyes, the thing in the story).
  - `pose`: `stand`, `walk`, `run`, `scared`, `point`, `sit`, `crouch`,
    `lie`, `reach`, `look_back`, `hide_face`.
  - `x`: horizontal position 0 to 1, or `[from, to]` to move across the scene.
  - `y` (optional): ground line 0 to 1, default 0.82.
  - `scale` (optional): default 1; use under 1 for distance.
  - `facing`: `left` or `right`.
  - `prop` (optional): `flashlight`, `phone`, `lantern`, `bag`.
  - `appearAt` / `leaveAt` (optional): fraction 0 to 1 of the scene when the
    figure appears or vanishes (good for a shadow that is suddenly there).
- `padSeconds` (optional): silence after the narration, for a beat to land.
