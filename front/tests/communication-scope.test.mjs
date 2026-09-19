import test from "node:test";
import assert from "node:assert/strict";
import { channelOwnerLabel, channelsForScope, filterCommunications, scopeQuery } from "../src/features/voice-agent/communicationScope.ts";

const data = {
  sites: [{ id: 1 }, { id: 2 }, { id: 3 }], courts: [{ site: 1 }, { site: 2 }],
  trialBookings: [{ id: 10, site: 1, source: "manual" }, { id: 20, site: 2 }],
  trialAvailabilityRules: [{ site: 1 }, { site: 2 }],
  voiceCalls: [{ id: 1, site: 1, to_number: "+101" }, { id: 2, site: 2, to_number: "+102" }, { id: 3, site: null, to_number: "+103" }],
  whatsappConversations: [
    { id: 1, site: 1, channel_site: 1, contact_phone: "+999", business_address: "whatsapp:+101" },
    { id: 2, site: 1, channel_site: 2, contact_phone: "+999", business_address: "whatsapp:+102" },
    { id: 3, site: null, channel_site: null, business_address: "whatsapp:+103" },
  ],
  whatsappFollowUpAssignees: [{ role: "admin", primary_site: null }, { role: "site_coordinator", primary_site: 1 }, { role: "site_coordinator", primary_site: 2 }],
  whatsappWeeklyStats: { total: 99 },
};
test("consolidated communications includes both channels even for the same contact", () => {
  const all = filterCommunications(data, { site: "all", address: "all" });
  assert.equal(all.whatsappConversations.length, 3);
  assert.equal(all.trialBookings.length, 2);
});
test("every subsection uses the selected site and never reuses global statistics", () => {
  const south = filterCommunications(data, { site: "2", address: "whatsapp:+102" });
  assert.deepEqual(south.whatsappConversations.map(c => c.id), [2]);
  assert.deepEqual(south.voiceCalls.map(c => c.id), [2]);
  assert.deepEqual(south.trialBookings.map(b => b.id), [20]);
  assert.deepEqual(south.trialAvailabilityRules, [{ site: 2 }]);
  assert.equal(south.whatsappFollowUpAssignees.length, 2);
  assert.equal(south.whatsappWeeklyStats, null);
  const query = new URLSearchParams(scopeQuery({ site: "2", address: "whatsapp:+102" }));
  assert.equal(query.get("business_address"), "whatsapp:+102");
  assert.equal(query.get("site"), "2");
  assert.equal(query.get("scope"), "all");
});
test("empty site does not borrow another site's data; unassigned stays explicit", () => {
  const empty = filterCommunications(data, { site: "3", address: "all" });
  assert.equal(empty.whatsappConversations.length, 0);
  assert.equal(empty.voiceCalls.length, 0);
  assert.equal(empty.trialBookings.length, 0);
  const unassigned = filterCommunications(data, { site: "unassigned", address: "all" });
  assert.deepEqual(unassigned.whatsappConversations.map(c => c.id), [3]);
  assert.deepEqual(unassigned.voiceCalls.map(c => c.id), [3]);
  assert.equal(unassigned.trialAvailabilityRules.length, 0);
});
test("manual bookings stay in site agenda when choosing a phone", () => {
  const north = filterCommunications(data, { site: "1", address: "whatsapp:+101" });
  assert.equal(north.trialBookings[0].source, "manual");
  assert.equal(data.whatsappConversations.length, 3);
});
test("a call without a booking is scoped by its registered destination number", () => {
  const north = filterCommunications(data, { site: "1", address: "whatsapp:+103" }, [{ business_address: "whatsapp:+103", site: 1, site_name: "Norte" }]);
  assert.deepEqual(north.voiceCalls.map(c => c.id), [3]);
});
test("all numbers in one site keep every channel available to consolidated panels", () => {
  const channels = [
    { business_address: "whatsapp:+101", site: 1, site_name: "Franco", channel_label: "Academia" },
    { business_address: "whatsapp:+102", site: 1, site_name: "Franco", channel_label: "Liga" },
    { business_address: "whatsapp:+103", site: 2, site_name: "UVM", channel_label: "Academia" },
    { business_address: "whatsapp:+104", site: null, site_name: "", channel_label: "Pendiente" },
  ];
  assert.deepEqual(channelsForScope(channels, { site: "1", address: "all" }).map(channel => channel.channel_label), ["Academia", "Liga"]);
  assert.deepEqual(channelsForScope(channels, { site: "1", address: "whatsapp:+102" }).map(channel => channel.channel_label), ["Liga"]);
  assert.deepEqual(channelsForScope(channels, { site: "unassigned", address: "all" }).map(channel => channel.channel_label), ["Pendiente"]);
});

test("template owner uses the linked site when a channel has no custom label", () => {
  assert.equal(channelOwnerLabel({
    business_address: "whatsapp:+525574858165",
    site: 41,
    site_name: "UVM",
    channel_label: "",
  }), "UVM");
  assert.equal(channelOwnerLabel({
    business_address: "meta:105039749242267",
    site: 27,
    site_name: "Colegio Franco",
    channel_label: "Franco Academia",
  }), "Franco Academia");
});
