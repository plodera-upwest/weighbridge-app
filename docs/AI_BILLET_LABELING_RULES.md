# AI Billet Labeling Rules

Use these rules when preparing images for the AI Product Counting model.

## Positive Class

- Label only billets that are physically on the conveyor belt.
- The class name must be `billet`.
- Use frames from the exact production camera angle used by the counting module.

## Do Not Label As Billet

- People walking near or across the conveyor.
- Crane hooks, crane arms, machinery, rollers, and background objects.
- Suspended or hoisted billets outside the conveyor zone.
- Shadows, light glare, hot reflections, and other bright non-billet objects.

## Negative Examples To Include

- Empty conveyor.
- People walking.
- Crane movement.
- Suspended billets.
- Shadows and light glare.
- Hot reflections from surrounding machinery or billet glow.

## Review Checklist

- Every positive label is a billet on the conveyor belt.
- No person, crane, or suspended billet is labeled as `billet`.
- The dataset includes both normal billet movement and difficult negative examples.
- The camera view matches the live production camera angle.
