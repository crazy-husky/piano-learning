# Third-party audio

The sampled piano path in `piano.ts` loads the required Salamander Grand Piano MP3 samples from the local
`public/audio/salamander/` directory. The files are served from the app's own origin, including when deployed under a
subpath such as GitHub Pages.

- Source: https://github.com/Tonejs/audio/tree/master/salamander
- Original author: Alexander Holm
- License: Creative Commons Attribution 3.0 (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/
- Bundled subset: the 26 MP3 files listed by `PIANO_SAMPLE_URLS` in `piano.ts`.

The metronome's percussion samples are bundled locally so they remain available offline and under the app's
`/piano-learning/` deployment path.

- Source: https://github.com/duoduosysa/defoldmuyu/blob/master/assets/sounds/mokugyo.wav
- License: CC0 1.0 Universal, as stated by the source repository README and LICENSE.
- Original sample: `src/features/metronome/assets/mokugyo.wav`.
- User-provided sample A: `src/features/metronome/assets/mokugyo-variant-a.mp3`.
- User-provided sample B: `src/features/metronome/assets/mokugyo-variant-b.mp3`.
- The two user-provided MP3 files were decoded from the supplied data URLs without re-encoding. Their original source and license metadata were not included.
