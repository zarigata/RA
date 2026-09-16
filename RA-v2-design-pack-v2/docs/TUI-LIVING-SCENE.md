# RA Living TUI Specification

## Objective

Create a beautiful Egyptian terminal workspace that remains useful, fast and readable over local terminals, SSH and tmux.

The visual layer must never interfere with the coding-agent runtime.

## Scene periods

RA reads the computer's local time once per minute.

- Dawn: 05:00–07:29
- Day: 07:30–16:59
- Sunset: 17:00–19:29
- Night: 19:30–04:59

Allow configuration of boundaries.

## Scene elements

### Dawn
- sun emerging from horizon;
- 0–3 remaining stars;
- two-frame bird silhouettes;
- soft Nile shimmer.

### Day
- sun position mapped across sky;
- sparse cloud/bird animation;
- clear pyramids;
- brighter status labels.

### Sunset
- descending sun;
- progressively appearing stars;
- torches begin flickering;
- strongest silhouette effect.

### Night
- moon phase can optionally be approximated from date;
- stars twinkle at randomized low frequency;
- torches flicker;
- Nile reflects moon;
- rare shooting star.

## System-state symbolism

The decorative scene can communicate runtime state.

| Symbol | State |
|---|---|
| scarab walking | tool/agent executing |
| Nile pulse | streamed tokens arriving |
| torch lit | local model active |
| obelisk lit | cloud/frontier model active |
| scales moving | Ma'at review underway |
| balanced scales | deterministic verification passed |
| papyrus roll | context summarization/compaction |
| eclipse | critical error / provider outage |

## Layout

Wide terminals:
- living scene header;
- Papyrus/context panel;
- Temple server panel;
- Council/agents panel;
- Ma'at/verification panel;
- conversation;
- input.

Medium:
- compact one-line scene;
- server/context split;
- conversation;
- input.

Narrow:
- no landscape;
- icon + time + model + context;
- conversation;
- input.

## Performance rules

- target 4–8 FPS only while an animation is visibly changing;
- otherwise repaint on events;
- no busy loop;
- pause decorative animation when terminal is unfocused where detectable;
- pause when model output scroll rate is high;
- reduced-motion setting;
- disable animation automatically on `TERM=dumb`;
- avoid Unicode characters whose width is inconsistent unless tested;
- animations must be cancellable and never own the event loop.

## Commands

```text
/scene auto
/scene dawn
/scene day
/scene sunset
/scene night
/scene minimal

/motion full
/motion reduced
/motion off

/theme pharaonic
```

## Suggested components

- `SceneClock`
- `SceneState`
- `CelestialBody`
- `PyramidLayer`
- `NileLayer`
- `ParticleLayer`
- `RuntimeGlyphLayer`
- `ResponsiveScene`
- `MotionPolicy`

The renderer should produce pure lines from state. This keeps snapshot testing easy.

## Time mapping

Map the current minute within the scene interval to a normalized `0..1` value.

Example:
- sunrise sun X position goes left -> center;
- daytime sun moves center-left -> center-right;
- sunset moves center-right -> horizon.

Do not need geolocation. Local PC time is sufficient.

## Accessibility

- every animated runtime state also has text;
- no critical meaning encoded only by color;
- respect no-color mode;
- support reduced motion;
- configurable scene height;
- high-contrast palette.
