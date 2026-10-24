import type { SourceStatus } from '../../server/ingest/manager.js';

/** The name an owner knows each ingest source by — never the code name ("kegtron_cloud"). */
export const SOURCE_LABELS: Record<SourceStatus['name'], string> = {
  kegtron_cloud: 'Kegtron cloud',
  kegtron_udp: 'Kegtron on the network',
  gen1_mqtt: 'Kegtron Gen 1 over MQTT',
  gen1_ble: 'Kegtron Gen 1 over Bluetooth',
  pro_ble: 'Kegtron Pro over Bluetooth',
  mqtt_publisher: 'Home Assistant publisher',
  govee: 'Govee gateway',
  motion_mqtt: 'Motion sensor over MQTT',
  motion_gpio: 'Motion sensor on GPIO',
  motion_ble: 'Motion sensor over Bluetooth',
};

export function sourceLabel(name: string): string {
  return (SOURCE_LABELS as Record<string, string>)[name] ?? name;
}
