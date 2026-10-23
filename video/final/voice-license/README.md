# Public narration source and license

The public CrewLift demo uses **Kokoro-82M v1.0**, the official **af_heart** American English preset, generated locally with the `kokoro` inference library. No Apple system voice, cloned person, third-party voice recording, or paid voice service is included in the public MP4.

The official model repository declares **Apache License 2.0** and describes production use. Its official voice catalog lists af_heart as an American English preset. The publisher's inference code also carries Apache License 2.0. Section 2 grants public performance and distribution rights subject to the license terms. We selected this stack for public distribution of the generated narration; it is not subject to the Apple System Voices license. The underlying code and model weights are not bundled with the public video.

## Authoritative sources

- Model and license declaration: https://huggingface.co/hexgrad/Kokoro-82M
- Voice catalog: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
- Inference library: https://github.com/hexgrad/kokoro
- Full Apache 2.0 license from the publisher: https://github.com/hexgrad/kokoro/blob/main/LICENSE

Verified source snapshot: `hexgrad/Kokoro-82M` revision `f3ff3571791e39611d31c381e3a41a3af07b4987`. This folder preserves the model card, voice catalog, full publisher license, exact source URLs, and document hashes. The model card retains the publisher's upstream dataset acknowledgments, including its Koniwa and SIWIS links.

## Downloaded artifact fingerprints

| Artifact | SHA-256 |
| --- | --- |
| kokoro-v1_0.pth | `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4` |
| af_heart.pt | `0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff` |
| config.json | `5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f` |

## Suggested public description credit

Narration generated locally with Kokoro-82M v1.0 (af_heart voice), released by hexgrad under Apache License 2.0: https://huggingface.co/hexgrad/Kokoro-82M

The narration is synthetic. The script is the project's original demonstration copy. The model/voice files were not modified; generated utterances were resampled, loudness-normalized, and fitted to the existing video cue windows. No endorsement by the voice-model publisher is implied.
