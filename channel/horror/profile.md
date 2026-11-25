# Channel profile: horror

Every agent in `.claude/agents/` reads this file before working. Change the
niche by adding another folder under `channel/` and naming it when you start
`/yt-studio`. Lines marked (assumed) are defaults nobody has confirmed yet;
replace them with your own answers.

## Niche

Original long-form horror stories, narrated over animated stick-figure scenes.
Slow-burn dread over jump scares: something small and wrong, getting worse.
Sub-genres that fit: night-shift and workplace horror, rules horror, small
towns with a secret, liminal places, "I should not have answered" stories,
folklore retold in a modern setting.

## Who we are talking to (assumed)

One person: someone in their late teens to thirties who plays a long story
in the background at night, alone, with headphones. They have heard every
famous creepypasta already and they leave the moment a story feels generic.

## Format

- 8 to 10 minutes. At about 140 spoken words per minute, a script is
  1,150 to 1,400 narration words. Hard limits: under 7:30 or over 10:30 fails QA.
- 16:9, 1920x1080, 24 fps.
- Faceless. One narrator, first person ("I"), past tense, unless a story needs
  otherwise.
- Visuals: code-drawn white stick figures on dark, moody scenes. A Higgsfield
  image is used only as a background for a scene that code shapes cannot
  carry (a specific house, a landscape), never for the characters.
- Captions on, lower third.
- No channel intro and no "before we start, subscribe". One ask, at the end.

## How the narrator talks

- Plain, specific, a little tired. Like someone who has told this story out
  loud before and still does not like telling it.
- Concrete details over adjectives: a time, a room number, the brand-less
  object, the exact words someone said. "The vending machine hummed" beats
  "an eerie atmosphere".
- Short sentences when it gets close. Longer ones when it is calm.
- Dread comes from what is withheld. Never explain the monster fully.

## Words and moves we never use

- Clichés: "sent shivers down my spine", "little did I know", "the air was
  thick with", "blood ran cold", "a chill ran through", "eerie silence",
  "something wasn't right" as a standalone line.
- Opening with "Hey guys", "Welcome back", or the channel name.
- Glued dashes like "dark—then" (they break caption timing). Use a period.
- "This is a true story." Everything here is fiction and the description
  says so.

## What we will not do

- Graphic gore, self-harm or suicide as a plot device, harm to children or
  animals shown or described in detail. Implied is fine; graphic is not.
- Real people, real crimes, real missing-person cases, or real places named
  as haunted. Invent the town.
- Retell someone else's copyrighted story. Folklore themes are fine; the
  telling must be ours.
- Claim a view count, a sales figure or a source we do not have.

## Narrator voice shortlist (from the ElevenLabs workspace)

These are voices saved in the workspace. The creator agent picks one per
story and records the choice in `scenes.json`. Previewing them is free;
generating narration costs ElevenLabs credits.

| Voice | voice_id | Why |
| --- | --- | --- |
| Ian Cartwell, Suspense, Mystery and Thriller | e5WNhrdI30aXpS2RSGm1 | American, modulated, built for mystery and true-crime pacing. Default. |
| Cedric M, Slow-Burn Storyteller for Horror and Mystery | BQOei2tk6QCBMHQWPhbj | British, deep, slow and deliberate. Best for folklore and old-house stories. |
| Bradford, British Narrator, Storyteller | NNl6r8mD7vthiJatiJt1 | Calm, articulate. For quieter, sadder stories. |
| Nick, Deep but emotive (library) | RxBN8b0BXGtpQOWiJw0Z | American, deep, strong on emotional beats. |

Suggested settings for horror narration: stability 0.40, similarity 0.80,
style 0.35. Lower stability sounds more emotional but drifts on a 10-minute
read.

## Publishing defaults (assumed)

- Upload as private with a scheduled publish time; never public immediately.
- Category: Entertainment. Made for kids: no.
- Altered or synthetic content: disclose (AI narration and generated imagery).
