-- ── Retire the /pricing copy blocks ──────────────────────────────────────────
--
-- /pricing is now a redirect. The landing page carries its own pricing section
-- (app/components/landing/v2/Pricing.tsx, anchored #pricing and linked from the
-- nav and footer), and a signed-in teacher manages their plan in /profile, so
-- nothing rendered these two strings any more.
--
-- Left in place they would be worse than useless: /admin/copy would still offer
-- them for editing, and an admin would publish a headline that appears on no
-- page at all. `pricing.headline` and `pricing.sub` are gone from CopyKey and
-- from SURFACES in the same change.
--
-- ORDER MATTERS, and not for the usual reason. copy_block_versions has NO
-- foreign key to copy_blocks, so deleting the block alone leaves its version
-- history behind, unreferenced and invisible: admin_copy_history() would still
-- return rows for a key nothing renders, and a version row surviving a key that
-- later comes back would splice old edits onto a new block. Versions first.
-- Same sequence, and the same trap, as 20260813000100_copy_seed_and_prune.sql.

delete from copy_block_versions where key in ('pricing.headline', 'pricing.sub');
delete from copy_blocks         where key in ('pricing.headline', 'pricing.sub');
