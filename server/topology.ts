export interface Interface {
  id: string;
  name: string;
  description: string;
  status: "up" | "down";
  connectedTo?: { device: string; iface: string };
}

export interface Device {
  id: string;
  name: string;
  role: "spine" | "leaf" | "border";
  model: string;
  mgmtIp: string;
  interfaces: Interface[];
}

export interface Link {
  id: string;
  a: { device: string; iface: string };
  b: { device: string; iface: string };
}

const mkIface = (
  device: string,
  name: string,
  description: string,
  connectedTo?: { device: string; iface: string },
  status: "up" | "down" = "up"
): Interface => ({
  id: `${device}:${name}`,
  name,
  description,
  status,
  connectedTo,
});

export const devices: Device[] = [
  {
    id: "spine1",
    name: "SPINE-1",
    role: "spine",
    model: "N9K-C9336C-FX2",
    mgmtIp: "10.0.0.11",
    interfaces: [
      mkIface("spine1", "Ethernet1/1", "Uplink to LEAF-1", { device: "leaf1", iface: "Ethernet1/49" }),
      mkIface("spine1", "Ethernet1/2", "Uplink to LEAF-2", { device: "leaf2", iface: "Ethernet1/49" }),
      mkIface("spine1", "Ethernet1/3", "Uplink to LEAF-3", { device: "leaf3", iface: "Ethernet1/49" }),
      mkIface("spine1", "mgmt0", "Management", undefined),
    ],
  },
  {
    id: "spine2",
    name: "SPINE-2",
    role: "spine",
    model: "N9K-C9336C-FX2",
    mgmtIp: "10.0.0.12",
    interfaces: [
      mkIface("spine2", "Ethernet1/1", "Uplink to LEAF-1", { device: "leaf1", iface: "Ethernet1/50" }),
      mkIface("spine2", "Ethernet1/2", "Uplink to LEAF-2", { device: "leaf2", iface: "Ethernet1/50" }),
      mkIface("spine2", "Ethernet1/3", "Uplink to LEAF-3", { device: "leaf3", iface: "Ethernet1/50" }),
      mkIface("spine2", "mgmt0", "Management", undefined),
    ],
  },
  {
    id: "leaf1",
    name: "LEAF-1",
    role: "leaf",
    model: "N9K-C93180YC-FX3",
    mgmtIp: "10.0.0.21",
    interfaces: [
      mkIface("leaf1", "Ethernet1/49", "Uplink to SPINE-1", { device: "spine1", iface: "Ethernet1/1" }),
      mkIface("leaf1", "Ethernet1/50", "Uplink to SPINE-2", { device: "spine2", iface: "Ethernet1/1" }),
      mkIface("leaf1", "Ethernet1/1", "Server rack A - host 1"),
      mkIface("leaf1", "Ethernet1/2", "Server rack A - host 2"),
      mkIface("leaf1", "Ethernet1/3", "Server rack A - host 3", undefined, "down"),
      mkIface("leaf1", "mgmt0", "Management", undefined),
    ],
  },
  {
    id: "leaf2",
    name: "LEAF-2",
    role: "leaf",
    model: "N9K-C93180YC-FX3",
    mgmtIp: "10.0.0.22",
    interfaces: [
      mkIface("leaf2", "Ethernet1/49", "Uplink to SPINE-1", { device: "spine1", iface: "Ethernet1/2" }),
      mkIface("leaf2", "Ethernet1/50", "Uplink to SPINE-2", { device: "spine2", iface: "Ethernet1/2" }),
      mkIface("leaf2", "Ethernet1/1", "Server rack B - host 1"),
      mkIface("leaf2", "Ethernet1/2", "Server rack B - host 2"),
      mkIface("leaf2", "mgmt0", "Management", undefined),
    ],
  },
  {
    id: "leaf3",
    name: "LEAF-3",
    role: "leaf",
    model: "N9K-C93180YC-FX3",
    mgmtIp: "10.0.0.23",
    interfaces: [
      mkIface("leaf3", "Ethernet1/49", "Uplink to SPINE-1", { device: "spine1", iface: "Ethernet1/3" }),
      mkIface("leaf3", "Ethernet1/50", "Uplink to SPINE-2", { device: "spine2", iface: "Ethernet1/3" }),
      mkIface("leaf3", "Ethernet1/1", "Storage array - port 1"),
      mkIface("leaf3", "Ethernet1/2", "Storage array - port 2"),
      mkIface("leaf3", "mgmt0", "Management", undefined),
    ],
  },
];

export const links: Link[] = [
  { id: "l1", a: { device: "spine1", iface: "Ethernet1/1" }, b: { device: "leaf1", iface: "Ethernet1/49" } },
  { id: "l2", a: { device: "spine1", iface: "Ethernet1/2" }, b: { device: "leaf2", iface: "Ethernet1/49" } },
  { id: "l3", a: { device: "spine1", iface: "Ethernet1/3" }, b: { device: "leaf3", iface: "Ethernet1/49" } },
  { id: "l4", a: { device: "spine2", iface: "Ethernet1/1" }, b: { device: "leaf1", iface: "Ethernet1/50" } },
  { id: "l5", a: { device: "spine2", iface: "Ethernet1/2" }, b: { device: "leaf2", iface: "Ethernet1/50" } },
  { id: "l6", a: { device: "spine2", iface: "Ethernet1/3" }, b: { device: "leaf3", iface: "Ethernet1/50" } },
];

export function topologyDescription(): string {
  const lines: string[] = ["NETWORK TOPOLOGY (Cisco Nexus 9000 spine-leaf fabric):"];
  for (const d of devices) {
    lines.push(`- ${d.name} (${d.model}, role: ${d.role}, mgmt ${d.mgmtIp})`);
    for (const i of d.interfaces) {
      const conn = i.connectedTo
        ? ` -> connected to ${devices.find((x) => x.id === i.connectedTo!.device)?.name ?? i.connectedTo.device} ${i.connectedTo.iface}`
        : "";
      lines.push(`    ${i.name} [${i.status}] ${i.description}${conn}`);
    }
  }
  return lines.join("\n");
}
