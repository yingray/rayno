// Adapted from Happy (MIT). See PROTOCOL-SOURCES.md.
/**
 * Power, network and load of a computer that runs the Happy daemon.
 *
 * The daemon has no RPC for this, but it serves the machine-wide `bash` RPC.
 * The app sends MACHINE_HEALTH_SCRIPT through it and parses the `key=value`
 * lines here. This keeps the feature in the app: a daemon of any version
 * answers, and nothing on the computer has to be rebuilt.
 *
 * Every command in the script is read-only and fails soft: a missing tool
 * prints an empty value, and the parser turns an empty value into null.
 */

// POSIX sh: the daemon runs the command through child_process.exec.
export const MACHINE_HEALTH_SCRIPT = String.raw`
echo "os=$(uname -s)"
echo "now=$(date +%s)"
if [ "$(uname -s)" = Darwin ]; then
  b=$(pmset -g batt 2>/dev/null)
  echo "power_source=$(printf '%s\n' "$b" | sed -n "s/.*drawing from '\(.*\)'.*/\1/p")"
  echo "battery=$(printf '%s\n' "$b" | grep -m1 'InternalBattery' | cut -f2-)"
  iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  echo "iface=$iface"
  if [ -n "$iface" ]; then
    echo "iface_port=$(networksetup -listallhardwareports 2>/dev/null | awk -v d="Device: $iface" '/^Hardware Port:/{p=substr($0,16)} $0==d{print p; exit}')"
    echo "ip=$(ipconfig getifaddr "$iface" 2>/dev/null)"
    echo "ssid=$(ipconfig getsummary "$iface" 2>/dev/null | awk -F' : ' '/^ *SSID :/{print $2; exit}')"
  fi
  echo "ipv4_all=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | tr '\n' ' ')"
  echo "load=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}')"
  echo "ncpu=$(sysctl -n hw.ncpu 2>/dev/null)"
  echo "boot=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/^{ sec = \([0-9]*\),.*/\1/p')"
  echo "mem_total=$(sysctl -n hw.memsize 2>/dev/null)"
  echo "mem_free_pct=$(memory_pressure -Q 2>/dev/null | sed -n 's/.*percentage: \([0-9]*\)%.*/\1/p')"
  echo "lid=$(ioreg -r -k AppleClamshellState -d 4 2>/dev/null | sed -n 's/.*"AppleClamshellState" = \([A-Za-z]*\).*/\1/p' | head -1)"
  p=$(pmset -g 2>/dev/null)
  echo "sleep=$(printf '%s\n' "$p" | sed -n 's/^ *sleep  *//p' | head -1)"
  echo "sleep_disabled=$(printf '%s\n' "$p" | awk '/SleepDisabled/{print $2}')"
  echo "low_power=$(printf '%s\n' "$p" | awk '/lowpowermode/{print $2}')"
else
  for d in /sys/class/power_supply/*; do
    [ -r "$d/type" ] || continue
    case "$(cat "$d/type")" in
      Battery) echo "linux_battery=$(cat "$d/capacity" 2>/dev/null) $(cat "$d/status" 2>/dev/null)" ;;
      Mains) echo "linux_ac=$(cat "$d/online" 2>/dev/null)" ;;
    esac
  done
  iface=$(ip route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')
  echo "iface=$iface"
  if [ -n "$iface" ]; then
    [ -d "/sys/class/net/$iface/wireless" ] && echo "iface_port=Wi-Fi"
    echo "ip=$(ip -4 -o addr show dev "$iface" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
    command -v iwgetid >/dev/null 2>&1 && echo "ssid=$(iwgetid -r 2>/dev/null)"
  fi
  echo "ipv4_all=$(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
  echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
  echo "ncpu=$(nproc 2>/dev/null)"
  echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
  echo "mem_total=$(awk '/^MemTotal:/{print $2*1024}' /proc/meminfo 2>/dev/null)"
  echo "mem_free_pct=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{if(t) printf "%d", a*100/t}' /proc/meminfo 2>/dev/null)"
fi
echo "disk=$(df -kP "$HOME" 2>/dev/null | awk 'NR==2{print $2, $4}')"
`;

export type BatteryState = 'charging' | 'discharging' | 'charged' | 'not-charging' | 'unknown';

export type MachineHealth = {
  battery: {
    percent: number;
    state: BatteryState;
    /** null when the OS has no estimate yet. */
    remainingMinutes: number | null;
  } | null;
  /** null when the OS did not say (for example a desktop with no battery on Linux). */
  onAcPower: boolean | null;
  network: {
    /** The interface of the default route; null means no route, so no network. */
    interface: string | null;
    kind: 'wifi' | 'ethernet' | 'other' | null;
    /** macOS 14+ hides the SSID from processes without location access. */
    ssid: string | null;
    ip: string | null;
    tailscaleIp: string | null;
  };
  load: { one: number; five: number; fifteen: number; cpuCount: number | null } | null;
  memory: { totalBytes: number | null; freePercent: number } | null;
  disk: { totalBytes: number; freeBytes: number } | null;
  uptimeSeconds: number | null;
  /** macOS only. */
  lidClosed: boolean | null;
  /** macOS only. */
  sleep: {
    /** `pmset disablesleep 1`: the system never sleeps, lid closed or not. */
    disabled: boolean;
    /** Idle sleep delay in minutes; 0 means never. */
    idleMinutes: number | null;
    /** Processes that hold a sleep assertion, as pmset lists them. */
    preventedBy: string[];
  } | null;
  lowPowerMode: boolean | null;
};

function readLines(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    // A repeated key (two batteries) keeps the first one.
    if (!values.has(key)) values.set(key, value);
  }
  return values;
}

function toNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFlag(value: string | undefined): boolean | null {
  if (value == null || value === '') return null;
  return value === '1' || value.toLowerCase() === 'yes';
}

/** "49%; charging; 1:19 remaining present: true" (pmset -g batt). */
export function parseDarwinBattery(line: string | undefined): MachineHealth['battery'] {
  if (!line) return null;
  const percentMatch = line.match(/(\d+)%/);
  if (!percentMatch) return null;
  // "80%; AC attached; not charging present: true" puts the state third.
  const status = line.toLowerCase();
  let state: BatteryState = 'unknown';
  if (/\bdischarging\b/.test(status)) state = 'discharging';
  else if (status.includes('not charging')) state = 'not-charging';
  else if (/\bcharging\b/.test(status) || status.includes('finishing charge')) state = 'charging';
  else if (/\bcharged\b/.test(status)) state = 'charged';
  const remaining = line.match(/(\d+):(\d{2}) remaining/);
  const remainingMinutes =
    remaining && state !== 'charged' ? Number(remaining[1]) * 60 + Number(remaining[2]) : null;
  return {
    percent: Number(percentMatch[1]),
    state,
    // pmset prints "0:00 remaining" while it is still measuring.
    remainingMinutes: remainingMinutes === 0 ? null : remainingMinutes,
  };
}

/** "87 Discharging" (/sys/class/power_supply/BAT0/{capacity,status}). */
export function parseLinuxBattery(line: string | undefined): MachineHealth['battery'] {
  if (!line) return null;
  const [capacity, ...rest] = line.split(' ');
  const percent = toNumber(capacity);
  if (percent == null) return null;
  const status = rest.join(' ').toLowerCase();
  const state: BatteryState =
    status === 'charging'
      ? 'charging'
      : status === 'discharging'
        ? 'discharging'
        : status === 'full'
          ? 'charged'
          : status === 'not charging'
            ? 'not-charging'
            : 'unknown';
  return { percent, state, remainingMinutes: null };
}

/** Tailscale hands out addresses from the CGNAT block 100.64.0.0/10. */
export function pickTailscaleIp(addresses: string | undefined): string | null {
  for (const address of (addresses ?? '').split(/\s+/)) {
    const match = address.match(/^100\.(\d+)\.\d+\.\d+$/);
    if (match && Number(match[1]) >= 64 && Number(match[1]) <= 127) return address;
  }
  return null;
}

/** "0 (sleep prevented by Claude, powerd, caffeinate)" (pmset -g). */
function parseSleep(line: string | undefined, disabled: boolean | null): MachineHealth['sleep'] {
  if (line == null && disabled == null) return null;
  const idleMinutes = toNumber(line?.match(/^(\d+)/)?.[1]);
  const by = line?.match(/sleep prevented by ([^)]*)\)/)?.[1];
  return {
    disabled: disabled === true,
    idleMinutes,
    preventedBy: by
      ? by
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      : [],
  };
}

export function parseMachineHealth(stdout: string): MachineHealth {
  const v = readLines(stdout);
  const darwin = v.get('os') === 'Darwin';

  const port = (v.get('iface_port') ?? '').toLowerCase();
  const iface = v.get('iface') || null;
  const kind = !iface
    ? null
    : port.includes('wi-fi') || port.includes('airport')
      ? 'wifi'
      : port.includes('ethernet') || port.includes('lan') || port.includes('thunderbolt')
        ? 'ethernet'
        : 'other';
  const ssid = v.get('ssid');

  const loadParts = (v.get('load') ?? '').split(/\s+/).filter(Boolean).map(Number);
  const load =
    loadParts.length >= 3 && loadParts.every(Number.isFinite)
      ? {
          one: loadParts[0],
          five: loadParts[1],
          fifteen: loadParts[2],
          cpuCount: toNumber(v.get('ncpu')),
        }
      : null;

  const freePercent = toNumber(v.get('mem_free_pct'));
  const [diskTotalKb, diskFreeKb] = (v.get('disk') ?? '').split(' ').map((part) => toNumber(part));

  const now = toNumber(v.get('now'));
  const boot = toNumber(v.get('boot'));
  const uptimeSeconds = darwin
    ? now != null && boot != null && now >= boot
      ? now - boot
      : null
    : toNumber(v.get('uptime'));

  const powerSource = v.get('power_source');
  const linuxAc = toFlag(v.get('linux_ac'));

  return {
    battery: darwin
      ? parseDarwinBattery(v.get('battery'))
      : parseLinuxBattery(v.get('linux_battery')),
    onAcPower: darwin ? (powerSource ? powerSource === 'AC Power' : null) : linuxAc,
    network: {
      interface: iface,
      kind,
      ssid: ssid && ssid !== '<redacted>' ? ssid : null,
      ip: v.get('ip') || null,
      tailscaleIp: pickTailscaleIp(v.get('ipv4_all')),
    },
    load,
    memory: freePercent != null ? { totalBytes: toNumber(v.get('mem_total')), freePercent } : null,
    disk:
      diskTotalKb != null && diskFreeKb != null
        ? { totalBytes: diskTotalKb * 1024, freeBytes: diskFreeKb * 1024 }
        : null,
    uptimeSeconds,
    lidClosed: darwin ? toFlag(v.get('lid')) : null,
    sleep: darwin ? parseSleep(v.get('sleep'), toFlag(v.get('sleep_disabled'))) : null,
    lowPowerMode: toFlag(v.get('low_power')),
  };
}

/** Below this battery percent, on battery power, the app warns. */
export const LOW_BATTERY_PERCENT = 20;
/** At or below this battery percent, on battery power, the warning is critical. */
export const CRITICAL_BATTERY_PERCENT = 10;

/**
 * 'critical' or 'low' when the computer runs on battery below
 * LOW_BATTERY_PERCENT; null otherwise. A computer on AC power never warns,
 * even with a low battery, because it does not lose power.
 */
export function getLowBatteryLevel(
  health: Pick<MachineHealth, 'battery' | 'onAcPower'>,
): 'low' | 'critical' | null {
  const { battery } = health;
  if (!battery) return null;
  const onBattery = battery.state === 'discharging' || health.onAcPower === false;
  if (!onBattery) return null;
  if (battery.percent <= CRITICAL_BATTERY_PERCENT) return 'critical';
  if (battery.percent < LOW_BATTERY_PERCENT) return 'low';
  return null;
}

export function formatDuration(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = Math.floor(totalMinutes % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
