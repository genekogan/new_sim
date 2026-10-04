# Exact boat source provenance

The original native journey's `geometry.sourceProposalSha256` identifies World's
authored proposal, not the older Core preview copy. These are different public
source files. The new provenance sidecar publishes both identities and a frozen
copy of the actual authored input without modifying the existing journey.

- World `fd27a26096bc445d07483525c487f2906e6a9325`,
  `worlds/eden/assets/fixtures/shore-dock-proposal.v1.json`: 12596B,
  SHA256 `ad33cee15e66b56e7b1de01de573807e4091faf0cbeae1a9d1eca28f8d97f754`.
- Core `9b97f9b322b58f542fd36ec9a35a874c6b298ed1`,
  `apps/server/test/fixtures/scene-placement/shore-world.v1.json`: 12552B,
  SHA256 `69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b`.
- Original actual native journey: 373388B,
  SHA256 `d213c66af75dedb07d9a5196e505bfb86376a5e8f9105d33242d5e57985a8923`.

The two proposal objects differ only in
`boardingConnectorProposal.release`. World's source says to refuse retraction
while occupied and retract only after safe contact release. The older preview
uses shorter ambiguous wording. Their numeric terrain, water, boat, dock, ramp
and connector are identical. The native controller already uses the safe policy;
no runtime correction or passing controller rerun is needed for this finding.

The new pure provenance check verifies both raw source hashes, exact source-copy
bytes, the single decoded wording difference, native terrain/diagonal/wet-domain
mapping, published connector, reversed ramp order and unchanged journey/layout.
The paired files live under `apps/server/test/fixtures/native-boat/` as
`source-proposal.v1.json` and `provenance.v1.json`.

The reported fine-body limitations remain: the inherited visual seated-pelvis
proxy has a 5cm gap; boarding depiction can cross raised-seat appearance. Those
are World/contact-profile work, not proof of fine leg/skin contact from capsule
or reciprocal passenger occupancy. Source provenance does not qualify that work.
