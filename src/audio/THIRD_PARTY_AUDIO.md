# Third-party audio

The sampled piano path in `piano.ts` loads the required Salamander Grand Piano MP3 samples from the local
`public/audio/salamander/` directory. The files are served from the app's own origin, including when deployed under a
subpath such as GitHub Pages.

- Source: https://github.com/Tonejs/audio/tree/master/salamander
- Original author: Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/
- Bundled subset: the 26 MP3 files listed by `PIANO_SAMPLE_URLS` in `piano.ts`.
