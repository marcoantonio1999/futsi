import type { AppData, WhatsAppConversation } from "../../types";

export type CommunicationChannel = { business_address: string; site: number | null; site_name: string; channel_label?: string; template_management_available?: boolean };
export type CommunicationScope = { site: string; address: string };
export function channelOwnerLabel(channel: CommunicationChannel) {
  return channel.channel_label || channel.site_name || channel.business_address.replace("whatsapp:", "").replace("meta:", "ID ");
}
export function conversationSite(c: WhatsAppConversation) {
  return c.channel_site !== undefined ? c.channel_site : c.site;
}
export function scopeQuery(scope: CommunicationScope) {
  const query = new URLSearchParams({ scope: "all" });
  if (scope.site !== "all") query.set("site", scope.site);
  if (scope.address !== "all") query.set("business_address", scope.address);
  return query.toString();
}
export function channelsForScope(channels: CommunicationChannel[], scope: CommunicationScope) {
  if (scope.address !== "all") return channels.filter(channel => channel.business_address === scope.address);
  if (scope.site === "all") return channels;
  return channels.filter(channel => scope.site === "unassigned" ? channel.site == null : String(channel.site) === scope.site);
}
export function filterCommunications(data: AppData, scope: CommunicationScope, channels: CommunicationChannel[] = []): AppData {
  const matchesSite = (id: number | null | undefined) => scope.site === "all" ||
    (scope.site === "unassigned" ? id == null : String(id) === scope.site);
  const calls = data.voiceCalls.filter(call => matchesSite(channels.find(channel => channel.business_address.replace(/^whatsapp:/, "") === call.to_number.replace(/^whatsapp:/, ""))?.site ?? call.site ?? call.booking_detail?.site) &&
    (scope.address === "all" || call.to_number.replace(/^whatsapp:/, "") === scope.address.replace(/^whatsapp:/, "")));
  return {
    ...data,
    sites: data.sites.filter(site => matchesSite(site.id)),
    courts: data.courts.filter(court => matchesSite(court.site)),
    // Bookings and availability belong to a site, including manual/web bookings.
    trialBookings: data.trialBookings.filter(booking => matchesSite(booking.site)),
    trialAvailabilityRules: data.trialAvailabilityRules.filter(rule => matchesSite(rule.site)),
    voiceCalls: calls,
    whatsappConversations: data.whatsappConversations.filter(c => matchesSite(conversationSite(c)) &&
      (scope.address === "all" || c.business_address === scope.address))
      .map(c => ({ ...c, site: conversationSite(c), site_name: c.channel_site_name ?? c.site_name })),
    whatsappFollowUpAssignees: data.whatsappFollowUpAssignees.filter(person => person.role !== "site_coordinator" || matchesSite(person.primary_site)),
    whatsappWeeklyStats: scope.site === "all" && scope.address === "all" ? data.whatsappWeeklyStats : null,
  };
}
