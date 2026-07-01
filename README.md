# DICOM-editor

A browser-based DICOM file metadata editor (single static `index.html`, uses
[dcmjs](https://github.com/dcmjs-org/dcmjs)). View, edit, create, compare, validate and
**de-identify** DICOM objects entirely client-side — no upload, no server.

## Tag dictionary

Tag names/VRs come from a **complete bundled DICOM PS3.6 Data Dictionary**
([`dicom-dictionary.js`](dicom-dictionary.js) — 5041 attributes + 88 repeating-group
masks), generated from the [Innolitics `dicom-standard`](https://github.com/innolitics/dicom-standard)
`attributes.json`. Lookup (`descFor` / `vrForTag`) is layered: author overrides → bundled
dictionary → repeating-group masks (`50xx`/`60xx`/`7Fxx`/`1000`/`1010`/`0028,04x0`…) →
dcmjs → generic "Private Tag". Every tag in the NEMA standard resolves — no more "Unknown
tag" for standard attributes (including retired ones).

To regenerate:

```bash
curl -sL https://raw.githubusercontent.com/innolitics/dicom-standard/master/standard/attributes.json -o attributes.json
# map each entry's { id, name, valueRepresentation } into window.DICOM_DICT / window.DICOM_DICT_MASKS
```

## De-identification

The **Anonymize** action implements the **DICOM PS3.15 Annex E, Table E.1‑1 — Basic
Application Level Confidentiality Profile**. The attribute action codes are generated from
the machine-readable [Innolitics `dicom-standard`](https://github.com/innolitics/dicom-standard)
table into [`deid-profile.js`](deid-profile.js) (617 attributes), which maps each tag to its
Basic Profile action:

| Code | Meaning | This tool |
| --- | --- | --- |
| `X` | remove | delete the attribute |
| `Z` | zero-length | empty value |
| `D` | dummy | non-zero dummy appropriate to the VR |
| `U` | UID | consistent remap (kept internally consistent across the loaded set) |
| `X/Z`, `X/Z/D`, `Z/D` | remove-or-blank | empty (never drops a maybe-required attribute) |
| `X/D` | remove-or-dummy | dummy |
| `X/Z/U*` | keep & remap | retained so nested UIDs remap (references survive) |

It is applied **recursively** into sequences (so PHI nested in Request Attributes,
Original Attributes, SR content, etc. is cleaned), and additionally:

- removes **private** attributes (all odd groups),
- removes **Curve** (`50xx`) and **Overlay** data/comments (`60xx,3000` / `60xx,4000`),
- remaps instance **UIDs** while preserving standard UIDs under `1.2.840.10008`
  (SOP Class, Transfer Syntax, coding schemes),
- writes the required de-identification markers **`(0012,0062)` Patient Identity Removed =
  `YES`**, **`(0012,0063)` De-identification Method**, and **`(0012,0064)` Method Code
  Sequence** `(113100, DCM, Basic Application Confidentiality Profile)`,
- warns when **`(0028,0301)` Burned In Annotation = YES** (identity in the *pixels* cannot
  be removed by a tag editor).

For clinical usability it applies the PS3.15 **Retain Patient Characteristics** option:
original **Patient's Sex** is kept, **Patient's Name** is set to a readable dummy, and
**Patient's Age** to `000Y`.

### Regenerating the profile table

```bash
curl -sL https://raw.githubusercontent.com/innolitics/dicom-standard/master/standard/confidentiality_profile_attributes.json -o conf.json
# then map each entry's { id, basicProfile } into window.DEID_PROFILE in deid-profile.js
```

### Not covered / limitations

- **Burned-in pixel data** is not redacted (a tag editor cannot touch pixels).
- The optional profiles (Clean Descriptors/Graphics/Structured Content, Retain
  Longitudinal Dates, etc.) are not yet exposed as toggles — the Basic Profile runs by
  default. The action table is periodically revised by NEMA; regenerate before relying on
  it for a production workflow.
