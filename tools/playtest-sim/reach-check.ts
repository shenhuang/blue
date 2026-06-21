import { createInitialGameState, mergeIntoInventory, HOME_LIGHTHOUSE_ID } from '@/engine/state';
import { buildAtLighthouse } from '@/engine/lighthouses';
import { generateChart, poiLockReason, isPoiDepartable, poiRevealState } from '@/engine/chart';

function freshPostTutorial(extraFlags: string[] = []) {
  let s: any = createInitialGameState();
  const flags = new Set<string>(['flag.tutorial_complete', 'story.ch1.hook', ...extraFlags]);
  s = { ...s, profile: { ...s.profile,
    flags,
    inventory: mergeIntoInventory(s.profile.inventory, [{ itemId: 'item.mentor_logbook', qty: 1 }]),
    bankedGold: 999, // isolate reveal/anchor gating from gold
  }};
  return s;
}

function listAnchors(s: any, label: string) {
  const chart = generateChart({ profile: s.profile });
  console.log(`\n--- ${label} ---`);
  for (const p of chart.pois) {
    const st = (p.story && p.story.anchor) ? p.story.anchor : null;
    if (!st && !/anchor/.test(p.id)) continue;
    const rs = poiRevealState(s.profile, p);
    console.log(`  ${(p.name||p.id).padEnd(14)} anchor=${String(st).padEnd(9)} reveal=${rs} departable=${isPoiDepartable(s.profile,p)} lock=${poiLockReason(s.profile,p)||'-'}`);
  }
}

// 1) post-tutorial, no dockyard
let s = freshPostTutorial();
listAnchors(s, 'post-tutorial (no dockyard, mentor_logbook in bag)');

// 2) + dockyard built
s = { ...s, profile: { ...s.profile, inventory: mergeIntoInventory(s.profile.inventory, [
  { itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }]) }};
s = buildAtLighthouse(s, HOME_LIGHTHOUSE_ID, 'lighthouse.dockyard.lv1');
listAnchors(s, '+ dockyard lv1');

// 3) + reef/wreck/midwater anchors done -> is vent anchor reachable?
s = freshPostTutorial(['story.ch1.anchor.reef','story.ch1.anchor.wreck','story.ch1.anchor.midwater']);
s = { ...s, profile: { ...s.profile, inventory: mergeIntoInventory(s.profile.inventory, [
  { itemId: 'item.coral_shard', qty: 6 }, { itemId: 'item.old_fishing_net', qty: 3 }]) }};
s = buildAtLighthouse(s, HOME_LIGHTHOUSE_ID, 'lighthouse.dockyard.lv1');
listAnchors(s, '+ 3 anchors done (vent should now be reachable?)');
