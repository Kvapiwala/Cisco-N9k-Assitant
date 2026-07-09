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
let topologyVersion = 0;

export function getTopology(): { devices: Device[]; links: Link[]; version: number } {
  return { devices, links, version: topologyVersion };
}

function bumpVersion() {
  topologyVersion++;
}

export function setTopology(newDevices: Device[], newLinks: Link[]) {
  devices = newDevices;
  links = newLinks;
  bumpVersion();
}

export function removeDevice(deviceId: string): boolean {
  const idx = devices.findIndex(d => d.id === deviceId);
  if (idx === -1) return false;
  devices.splice(idx, 1);
  // Clean up links referencing this device
  links = links.filter(l => l.a.device !== deviceId && l.b.device !== deviceId);
  // Clean up connectedTo references in remaining devices
  for (const d of devices) {
    for (const i of d.interfaces) {
      if (i.connectedTo?.device === deviceId) {
        i.connectedTo = undefined;
      }
    }
  }
  bumpVersion();
  return true;
}

export function clearTopology() {
  devices = [];
  links = [];
  bumpVersion();
}

export function normalizeTopology() {
  // Ensure full-mesh spine-leaf: every leaf connected to every spine.
  const spines = devices.filter(d => d.role === "spine");
  const leafs = devices.filter(d => d.role === "leaf");

  if (spines.length === 0 || leafs.length === 0) return;

  // Build set of existing spine-leaf pairs from links
  const existing = new Set<string>();
  for (const l of links) {
    const s = l.a;
    const t = l.b;
    existing.add(`${s.device}:${t.device}`);
    existing.add(`${t.device}:${s.device}`);
  }

  let changed = false;
  for (const spine of spines) {
    for (const leaf of leafs) {
      const key = `${spine.id}:${leaf.id}`;
      if (existing.has(key)) continue;

      // Find next free Ethernet slot on each device (module 1, sequential ports)
      const nextSlot = (dev: Device): string => {
        const ports = dev.interfaces
          .filter(i => i.name.match(/^Ethernet1\/\d+$/))
          .map(i => {
            const m = i.name.match(/^Ethernet1\/(\d+)$/);
            return m ? Number(m[1]) : 0;
          });
        const max = ports.length > 0 ? Math.max(...ports) : 0;
        return `Ethernet1/${max + 1}`;
      };

      const sIface = nextSlot(spine);
      const lIface = nextSlot(leaf);

      // Add interfaces
      spine.interfaces.push({
        id: `${spine.id}:${sIface}`,
        name: sIface,
        description: `to ${leaf.name}`,
        status: "up",
        connectedTo: { device: leaf.id, iface: lIface },
      });
      leaf.interfaces.push({
        id: `${leaf.id}:${lIface}`,
        name: lIface,
        description: `to ${spine.name}`,
        status: "up",
        connectedTo: { device: spine.id, iface: sIface },
      });

      // Add link
      const linkId = `l${links.length + 1}`;
      links.push({
        id: linkId,
        a: { device: spine.id, iface: sIface },
        b: { device: leaf.id, iface: lIface },
      });
      changed = true;
    }
  }
  if (changed) bumpVersion();
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
