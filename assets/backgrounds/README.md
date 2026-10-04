# Backgrounds

The photographs behind Who's watching on a TV
(`src/screens/profile-picker/tv.tsx`): one at random as it opens, then another
every 20 to 45 seconds, each credited on the screen — its photographer and
Unsplash — while it shows. Nothing else draws them.

They are photographs from [Unsplash](https://unsplash.com), used under the
[Unsplash License](https://unsplash.com/license). That licence, not the AGPL,
covers them: the AGPL is the code's (`NOTICE`).

| File | Photographer | The photo |
| --- | --- | --- |
| `alexander-slattery-LI748t0BK8w.jpg` | [Alexander Slattery](https://unsplash.com/@slatts) | <https://unsplash.com/photos/LI748t0BK8w> |
| `anders-jilden-cYrMQA7a3Wc.jpg` | [Anders Jildén](https://unsplash.com/@andersjilden) | <https://unsplash.com/photos/cYrMQA7a3Wc> |
| `dan-freeman-wAn4RfmXtxU.jpg` | [Dan Freeman](https://unsplash.com/@danfreemanphoto) | <https://unsplash.com/photos/wAn4RfmXtxU> |
| `garrett-parker-DlkF4-dbCOU.jpg` | [garrett parker](https://unsplash.com/@garrettpsystems) | <https://unsplash.com/photos/DlkF4-dbCOU> |
| `ian-dooley-DuBNA1QMpPA.jpg` | [ian dooley](https://unsplash.com/@sadswim) | <https://unsplash.com/photos/DuBNA1QMpPA> |
| `qingbao-meng-01_igFr7hd4.jpg` | [Qingbao Meng](https://unsplash.com/@ideasboom) | <https://unsplash.com/photos/01_igFr7hd4> |
| `urban-vintage-78A265wPiO4.jpg` | [Urban Vintage](https://unsplash.com/@urban_vintage) | <https://unsplash.com/photos/78A265wPiO4> |

`src/screens/profile-picker/backgrounds.ts` lists them with the same credits.
A photograph added here goes there too, with its photographer as Unsplash
spells the name.

## Making them again

The originals, as downloaded, are in the workspace root's
`.claude/UI Redesign/Backgrounds/`. Each is at most 2560 pixels on its long
side, a JPEG at quality 60, in sRGB — 4.5 MB for the seven, which every build
carries, a phone's too:

```bash
sips -Z 2560 -s format jpeg -s formatOptions 60 \
  --matchTo '/System/Library/ColorSync/Profiles/sRGB Profile.icc' \
  <original> --out assets/backgrounds/<photographer>-<photo id>.jpg
```

An original narrower than that keeps its own size — Anders Jildén's is 2400
wide — so leave `-Z 2560` out for it: `sips` enlarges as readily as it shrinks.
