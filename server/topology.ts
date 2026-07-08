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
  role: string;
  model: string;
  mgmtIp: string;
  interfaces: Interface[];
}

export interface Link {
  id: string;
  a: { device: string; iface: string };
  b: { device: string; iface: string };
}

let devices: Device[] = [];
let links: Link[] = [];

export function getTopology(): { devices: Device[]; links: Link[] } {
  return { devices, links };
}

export function setTopology(newDevices: Device[], newLinks: Link[]) {
  devices = newDevices;
  links = newLinks;
}

export function topologyDescription(): string {
  if (devices.length === 0) {
    return "NETWORK TOPOLOGY: none defined yet. If the user describes their topology (devices, links, interfaces), base your configurations on that description.";
  }
  const lines: string[] = ["NETWORK TOPOLOGY (as described by the user):"];
  for (const d of devices) {
    lines.push(`- ${d.name} (${d.model}, role: ${d.role}${d.mgmtIp ? `, mgmt ${d.mgmtIp}` : ""})`);
    for (const i of d.interfaces) {
      const conn = i.connectedTo
        ? ` -> connected to ${devices.find((x) => x.id === i.connectedTo!.device)?.name ?? i.connectedTo.device} ${i.connectedTo.iface}`
        : "";
      lines.push(`    ${i.name} [${i.status}] ${i.description}${conn}`);
    }
  }
  return lines.join("\n");
}
