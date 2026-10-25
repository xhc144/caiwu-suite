# Read-only PB static toolkit

Python 3.10+ standard library only. This directory contains generic code and fictional synthetic tests. It contains no installer, original object, runtime property profile, target hash, target SQL, decoded catalog or real sample output. Generated reports must remain in the consumer's authorized local workspace.

The toolkit never executes an installer, DLL, original program or expression. It reads byte structures and preserves unconfirmed semantics. Container success is not source recovery, event-dispatch recovery or a unique runtime call graph.

## One installer and one cache

Obtain only the installer already authorized for your task. Verify the expected SHA256 from that authorized source, then pass it explicitly:

```sh
python3 toolkit.py extract \
  --installer-file /authorized/input/setup.exe \
  --installer-sha256 "$EXPECTED_SHA256" \
  --installer-id "$INSTALLER_ID" \
  --manifest /authorized/input/manifest.csv \
  --stream-cache /local/work/installer-stream.bin \
  --output /local/work/extracted \
  --evidence /local/work/extraction-evidence.json
```

The PE overlay offset is calculated from its section table. The bounded zlib stream is decompressed once and reused only when cache provenance/hash match. FILE length coding is inferred from bounded metadata and validated with the manifest; there is no bundled package-specific mask. Default selection is `.pbd` records. Repeat `--record N` to select exact additionally authorized records. No selected output is written until every selected destination/size/hash matches uniquely. Existing output paths are never overwritten.

The CSV columns are `record,installer,original_destination,bytes,sha256,materialized_relative_path`. Preserve record-numbered relative paths; same names with different content must not overwrite each other. Ambiguous identical FILE candidates stop recovery rather than invent a provenance mapping.

## Container and object decoding

```sh
python3 toolkit.py probe \
  --manifest /authorized/input/manifest.csv --installer-id "$INSTALLER_ID" \
  --payload-root /local/work/extracted --output /local/work/containers

python3 toolkit.py analyze \
  --manifest /local/work/containers/selected-manifest.csv \
  --payload-root /local/work/extracted \
  --container-reports /local/work/containers \
  --output /local/work/analysis
```

`probe` preserves missing/rejected record statuses in its index. `analyze` consumes only complete verified reports, rechecks file SHA256 and raw ENT/DAT chains, and parses each unique file hash once. `record_aliases` preserves all verified manifest record IDs for repeated content. Output must be outside the input payload tree. Use `--stages classify windows dw functions calls cfb relations` to select stages.

The container reader supports bounded HDR/NOD/ENT/DAT metadata and logical-to-physical maps. The compiled-object readers gate the supported object profile, separate own/inherited/container types and local/GlobalIndex/RefIndex domains, and retain descriptor-only slots without pretending to decode their semantics. The PB90 length walker stops on unknown/truncated instructions; jump/debug targets are checked before broad call-descriptor reading. Candidate references remain separate from unique callee edges.

## DataWindow profile boundary

Without `--dw-profile`, PDW0900 record boundaries, structural columns, query references and raw visual tags are available. Named visual property offsets remain unknown. Column `+52` is an uninterpreted dword; it is not labeled a storage type or used to infer numeric precision. This first export does not include the separate runtime-backed datatype/scale specification layer.

An optional caller-owned JSON profile has `schema_version: "pb-dw-slots-1"`, `layout: "PDW0900"`, `evidence_status: "caller_verified_against_matching_runtime"`, and `groups` containing `column`, `compute`, `compute_visual`, and `text_visual` maps. Each named property entry has an integer `slot` and may retain the consumer's local evidence. No actual profile is bundled. The evidence string is an explicit trust boundary, not verification performed by the loader: the consumer must independently prove offsets against its own matching runtime before supplying it. Never borrow a profile merely because a DLL filename looks similar.

## Validation and provenance

```sh
python3 -W error::ResourceWarning -m unittest discover -v
```

Tests construct fictional ANSI/Unicode PB containers, class/property records, PDW records, PE overlays and call descriptors in memory. They cover hash mismatch, duplicate names, path escape, budgets, cycles, pointer bounds, byte maps, version gates, malformed instruction targets, profile absence and raw-column labeling.

The original container reader was previously authored in this project (`ca59dabf1f3c0fe358f4fea478e7dfb42006be32`); this export removes its package-specific executable-name selection. The independent class/function/P-code layout implementations cite fixed public source references in their modules. The factual PB90 operand-length vector is from MIT Hucxy/PbdViewer commit `b46fd3e42b8f26ed18a547b9e4bec47f96530a86`, `Uitils/PCode/PCodeParser90.cs`, blob `be7754e4ec83714fddc2e22881fd2be022f5fd3a`. No external implementation is executed. These references do not establish compatibility with every PB build; unsupported structures remain partial or unknown.
