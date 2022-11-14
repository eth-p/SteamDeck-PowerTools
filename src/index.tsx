import {
  ButtonItem,
  definePlugin,
  //DialogButton,
  //Menu,
  //MenuItem,
  PanelSection,
  PanelSectionRow,
  //Router,
  ServerAPI,
  //showContextMenu,
  staticClasses,
  SliderField,
  ToggleField,
  Dropdown,
  Field,
  //DropdownOption,
  SingleDropdownOption,
  //NotchLabel
  gamepadDialogClasses,
  joinClassNames,
} from "decky-frontend-lib";
import { VFC, useState } from "react";
import { GiDrill } from "react-icons/gi";

//import * as python from "./python";
import * as backend from "./backend";
import {set_value, get_value, target_usdpl, version_usdpl} from "usdpl-front";

var periodicHook: NodeJS.Timer | null = null;
var lifetimeHook: any = null;
var startHook: any = null;
var usdplReady = false;

var smtAllowed = true;
var advancedMode = false;
var advancedCpu = 1;

type MinMax = {
  min: number | null;
  max: number | null;
}

const governorOptions: SingleDropdownOption[] = [
  {
    data: "conservative",
    label: <span>conservative</span>,
  },
  {
    data: "ondemand",
    label: <span>ondemand</span>,
  },
  {
    data: "userspace",
    label: <span>userspace</span>,
  },
  {
    data: "powersave",
    label: <span>powersave</span>,
  },
  {
    data: "performance",
    label: <span>performance</span>,
  },
  {
    data: "schedutil",
    label: <span>schedutil</span>,
  },
];

// usdpl persistent store keys

const BACKEND_INFO = "VINFO";

const CURRENT_BATT = "BATTERY_current_now";
const CHARGE_RATE_BATT = "BATTERY_charge_rate";
const CHARGE_NOW_BATT = "BATTERY_charge_now";
const CHARGE_FULL_BATT = "BATTERY_charge_full";
const CHARGE_DESIGN_BATT = "BATTERY_charge_design"

const TOTAL_CPUS = "CPUs_total";
const ONLINE_CPUS = "CPUs_online";
const ONLINE_STATUS_CPUS = "CPUs_status_online";
const SMT_CPU = "CPUs_SMT";
const CLOCK_MIN_CPU = "CPUs_min_clock";
const CLOCK_MAX_CPU = "CPUs_max_clock";
const CLOCK_MIN_MAX_CPU = "CPUs_minmax_clocks";
const GOVERNOR_CPU = "CPUs_governor";

const FAST_PPT_GPU = "GPU_fastPPT";
const SLOW_PPT_GPU = "GPU_slowPPT";
const CLOCK_MIN_GPU = "GPU_min_clock";
const CLOCK_MAX_GPU = "GPU_max_clock";
const SLOW_MEMORY_GPU = "GPU_slow_memory";

const PERSISTENT_GEN = "GENERAL_persistent";
const NAME_GEN = "GENERAL_name";

function countCpus(statii: boolean[]): number {
  let count = 0;
  for (let i = 0; i < statii.length; i++) {
    if (statii[i]) {
      count += 1;
    }
  }
  return count;
}

function syncPlebClockToAdvanced() {
  const cpuCount = get_value(TOTAL_CPUS);
  const minClock = get_value(CLOCK_MIN_CPU);
  const maxClock = get_value(CLOCK_MAX_CPU);
  let clockArr = [];
  for (let i = 0; i < cpuCount; i++) {
    clockArr.push({
      min: minClock,
      max: maxClock,
    } as MinMax);
  }
  set_value(CLOCK_MIN_MAX_CPU, clockArr);
}

const reload = function() {
  if (!usdplReady) {return;}

  backend.resolve(backend.getBatteryCurrent(), (rate: number) => { set_value(CURRENT_BATT, rate) });
  backend.resolve(backend.getBatteryChargeRate(), (rate: number) => { set_value(CHARGE_RATE_BATT, rate) });
  backend.resolve(backend.getBatteryChargeNow(), (rate: number) => { set_value(CHARGE_NOW_BATT, rate) });
  backend.resolve(backend.getBatteryChargeFull(), (rate: number) => { set_value(CHARGE_FULL_BATT, rate) });
  backend.resolve(backend.getBatteryChargeDesign(), (rate: number) => { set_value(CHARGE_DESIGN_BATT, rate) });

  backend.resolve(backend.getCpuCount(), (count: number) => { set_value(TOTAL_CPUS, count)});
  backend.resolve(backend.getCpusOnline(), (statii: boolean[]) => {
    set_value(ONLINE_STATUS_CPUS, statii);
    const count = countCpus(statii);
    set_value(ONLINE_CPUS, count);
    set_value(SMT_CPU, statii.length > 3 && statii[0] == statii[1] && statii[2] == statii[3] && smtAllowed);
  });
  backend.resolve(backend.getCpuClockLimits(0), (limits: number[]) => {
    set_value(CLOCK_MIN_CPU, limits[0]);
    set_value(CLOCK_MAX_CPU, limits[1]);
    syncPlebClockToAdvanced();
  });
  backend.resolve(backend.getCpusGovernor(), (governors: string[]) => {
    set_value(GOVERNOR_CPU, governors);
    console.log("POWERTOOLS: Governors from backend", governors);
    console.log("POWERTOOLS: Governors in dropdown", governorOptions);
  });

  backend.resolve(backend.getGpuPpt(), (ppts: number[]) => {
    set_value(FAST_PPT_GPU, ppts[0]);
    set_value(SLOW_PPT_GPU, ppts[1]);
  });
  backend.resolve(backend.getGpuClockLimits(), (limits: number[]) => {
    set_value(CLOCK_MIN_GPU, limits[0]);
    set_value(CLOCK_MAX_GPU, limits[1]);
  });
  backend.resolve(backend.getGpuSlowMemory(), (status: boolean) => { set_value(SLOW_MEMORY_GPU, status) });

  backend.resolve(backend.getGeneralPersistent(), (value: boolean) => { set_value(PERSISTENT_GEN, value) });
  backend.resolve(backend.getGeneralSettingsName(), (name: string) => { set_value(NAME_GEN, name) });

  backend.resolve(backend.getInfo(), (info: string) => { set_value(BACKEND_INFO, info) });
};

// init USDPL WASM and connection to back-end
(async function(){
  await backend.initBackend();
  usdplReady = true;
  set_value(NAME_GEN, "Default");
  reload(); // technically this is only a load

  // register Steam callbacks
  //@ts-ignore
  lifetimeHook = SteamClient.GameSessions.RegisterForAppLifetimeNotifications((update) => {
      if (update.bRunning) {
          //console.debug("AppID " + update.unAppID.toString() + " is now running");
      } else {
          //console.debug("AppID " + update.unAppID.toString() + " is no longer running");
          backend.resolve(
            backend.loadGeneralDefaultSettings(),
            (ok: boolean) => {console.debug("Loading default settings ok? " + ok)}
          );
      }
  });
  //@ts-ignore
  startHook = SteamClient.Apps.RegisterForGameActionStart((actionType, id) => {
      //@ts-ignore
      let gameInfo: any = appStore.GetAppOverviewByGameID(id);
      // don't use gameInfo.appid, haha
      backend.resolve(
        backend.loadGeneralSettings(id.toString() + ".json", gameInfo.display_name),
        (ok: boolean) => {console.debug("Loading settings ok? " + ok)}
      );
  });

  console.debug("Registered PowerTools callbacks, hello!");
})();

const periodicals = function() {
  backend.resolve(backend.getBatteryCurrent(), (rate: number) => { set_value(CURRENT_BATT, rate) });
  backend.resolve(backend.getBatteryChargeNow(), (rate: number) => { set_value(CHARGE_NOW_BATT, rate) });
  backend.resolve(backend.getBatteryChargeFull(), (rate: number) => { set_value(CHARGE_FULL_BATT, rate) });

  backend.resolve(backend.getGeneralPersistent(), (value: boolean) => { set_value(PERSISTENT_GEN, value) });
  backend.resolve(backend.getGeneralSettingsName(), (name: string) => {
    const oldValue = get_value(NAME_GEN);
    set_value(NAME_GEN, name);
    if (name != oldValue) {
      reload();
    }
  });
};

const Content: VFC<{ serverAPI: ServerAPI }> = ({}) => {

  const [_idc, reloadGUI] = useState<any>("/shrug");

  if (periodicHook != null) {
    clearInterval(periodicHook);
    periodicHook = null;
  }

  periodicHook = setInterval(function() {
      periodicals();
      reloadGUI("periodic" + (new Date()).getTime().toString());
  }, 1000);

  const FieldWithSeparator = joinClassNames(gamepadDialogClasses.Field, gamepadDialogClasses.WithBottomSeparatorStandard);

  const total_cpus = get_value(TOTAL_CPUS);
  const advancedCpuIndex = advancedCpu - 1;

  return (
    <PanelSection>
      {/* CPU */}
      <div className={staticClasses.PanelSectionTitle}>
        CPU
      </div>
      <PanelSectionRow>
        <ToggleField
          checked={advancedMode}
          label="Advanced"
          description="Enables per-thread configuration"
          onChange={(advanced: boolean) => {
            advancedMode = advanced;
          }}
        />
      </PanelSectionRow>
      {/* CPU plebeian mode */}
      {!advancedMode && smtAllowed && <PanelSectionRow>
        <ToggleField
          checked={get_value(SMT_CPU)}
          label="SMT"
          description="Enables odd-numbered CPUs"
          onChange={(smt: boolean) => {
            console.debug("SMT is now " + smt.toString());
            const cpus = get_value(ONLINE_CPUS);
            const smtNow = smt && smtAllowed;
            backend.resolve(backend.setCpuSmt(smtNow), (newVal: boolean) => {
              set_value(SMT_CPU, newVal);
            });
            let onlines: boolean[] = [];
            for (let i = 0; i < total_cpus; i++) {
              const online = (smtNow? i < cpus : (i % 2 == 0) && (i < cpus * 2))
                || (!smtNow && cpus == 4);
              onlines.push(online);
            }
            backend.resolve(backend.setCpuOnlines(onlines), (statii: boolean[]) => {
              set_value(ONLINE_STATUS_CPUS, statii);
              const count = countCpus(statii);
              set_value(ONLINE_CPUS, count);
              reloadGUI("SMT");
            });
          }}
        />
      </PanelSectionRow>}
      {!advancedMode && <PanelSectionRow>
        <SliderField
          label="Threads"
          value={get_value(ONLINE_CPUS)}
          step={1}
          max={get_value(SMT_CPU)? total_cpus : total_cpus/2}
          min={1}
          showValue={true}
          onChange={(cpus: number) => {
            console.debug("CPU slider is now " + cpus.toString());
            const onlines = get_value(ONLINE_CPUS);
            if (cpus != onlines) {
              set_value(ONLINE_CPUS, cpus);
              const smtNow = get_value(SMT_CPU);
              let onlines: boolean[] = [];
              for (let i = 0; i < total_cpus; i++) {
                const online = smtNow? i < cpus : (i % 2 == 0) && (i < cpus * 2);
                onlines.push(online);
              }
              backend.resolve(backend.setCpuOnlines(onlines), (statii: boolean[]) => {
                set_value(ONLINE_STATUS_CPUS, statii);
                const count = countCpus(statii);
                set_value(ONLINE_CPUS, count);
                reloadGUI("CPUs");
              });
              reloadGUI("CPUsImmediate");
            }
          }}
        />
      </PanelSectionRow>}
      {!advancedMode && <PanelSectionRow>
        <ToggleField
          checked={get_value(CLOCK_MIN_CPU) != null && get_value(CLOCK_MAX_CPU) != null}
          label="Frequency Limits"
          description="Set bounds on clock speed"
          onChange={(value: boolean) => {
            if (value) {
              set_value(CLOCK_MIN_CPU, 1400);
              set_value(CLOCK_MAX_CPU, 3500);
              syncPlebClockToAdvanced();
              reloadGUI("CPUFreqToggle");
            } else {
              set_value(CLOCK_MIN_CPU, null);
              set_value(CLOCK_MAX_CPU, null);
              for (let i = 0; i < total_cpus; i++) {
                backend.resolve(backend.unsetCpuClockLimits(i), (_idc: any[]) => {});
              }
              backend.resolve(backend.waitForComplete(), (_: boolean) => {
                reloadGUI("CPUUnsetFreq");
              });
              syncPlebClockToAdvanced();
            }
          }}
        />
      </PanelSectionRow>}
      {!advancedMode && <PanelSectionRow>
        {get_value(CLOCK_MIN_CPU) != null && <SliderField
          label="Minimum (MHz)"
          value={get_value(CLOCK_MIN_CPU)}
          max={3500}
          min={1400}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MIN_CPU) == null}
          onChange={(freq: number) => {
            console.debug("Min freq slider is now " + freq.toString());
            const freqNow = get_value(CLOCK_MIN_CPU);
            if (freq != freqNow) {
              set_value(CLOCK_MIN_CPU, freq);
              for (let i = 0; i < total_cpus; i++) {
                backend.resolve(backend.setCpuClockLimits(i, freq, get_value(CLOCK_MAX_CPU)),
                                (limits: number[]) => {
                  set_value(CLOCK_MIN_CPU, limits[0]);
                  set_value(CLOCK_MAX_CPU, limits[1]);
                  syncPlebClockToAdvanced();
                });
              }
              backend.resolve(backend.waitForComplete(), (_: boolean) => {
                reloadGUI("CPUMinFreq");
              });
              reloadGUI("CPUMinFreqImmediate");
            }
          }}
        />}
      </PanelSectionRow>}
      {!advancedMode && <PanelSectionRow>
        {get_value(CLOCK_MAX_CPU) != null && <SliderField
          label="Maximum (MHz)"
          value={get_value(CLOCK_MAX_CPU)}
          max={3500}
          min={500}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MAX_CPU) == null}
          onChange={(freq: number) => {
            console.debug("Max freq slider is now " + freq.toString());
            const freqNow = get_value(CLOCK_MAX_CPU);
            if (freq != freqNow) {
              set_value(CLOCK_MAX_CPU, freq);
              for (let i = 0; i < total_cpus; i++) {
                backend.resolve(backend.setCpuClockLimits(i, get_value(CLOCK_MIN_CPU), freq),
                                (limits: number[]) => {
                  set_value(CLOCK_MIN_CPU, limits[0]);
                  set_value(CLOCK_MAX_CPU, limits[1]);
                  syncPlebClockToAdvanced();
                });
              }
              backend.resolve(backend.waitForComplete(), (_: boolean) => {
                reloadGUI("CPUMaxFreq");
              });
              reloadGUI("CPUMaxFreqImmediate");
            }
          }}
        />}
      </PanelSectionRow>}
      {/* CPU advanced mode */}
      {advancedMode && <PanelSectionRow>
        <SliderField
          label="CPU to modify"
          value={advancedCpu}
          step={1}
          max={8}
          min={1}
          showValue={true}
          onChange={(cpuNum: number) => {
            advancedCpu = cpuNum;
          }}
        />
      </PanelSectionRow>}
      {advancedMode && <PanelSectionRow>
        <ToggleField
          checked={get_value(ONLINE_CPUS)[advancedCpuIndex]}
          label="Online"
          description="Allow the CPU thread to do processing"
          onChange={(status: boolean) => {
            console.debug("CPU " + advancedCpu.toString() + " is now " + status.toString());
            if (get_value(SMT_CPU)) {
              backend.resolve(backend.setCpuSmt(false), (newVal: boolean) => {
                set_value(SMT_CPU, newVal);
              });
            }
            backend.resolve(backend.setCpuOnline(advancedCpuIndex, status), (newVal: boolean) => {
              const onlines = get_value(ONLINE_STATUS_CPUS);
              onlines[advancedCpuIndex] = newVal;
              set_value(ONLINE_STATUS_CPUS, onlines);
            });
          }}
        />
      </PanelSectionRow>}
      {advancedMode && <PanelSectionRow>
        <ToggleField
          checked={get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].min != null && get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].max}
          label="Frequency Limits"
          description="Set bounds on clock speed"
          onChange={(value: boolean) => {
            if (value) {
              const clocks = get_value(CLOCK_MIN_MAX_CPU) as MinMax[];
              clocks[advancedCpuIndex].min = 1400;
              clocks[advancedCpuIndex].max = 3500;
              set_value(CLOCK_MIN_MAX_CPU, clocks);
              reloadGUI("CPUFreqToggle");
            } else {
              const clocks = get_value(CLOCK_MIN_MAX_CPU) as MinMax[];
              clocks[advancedCpuIndex].min = null;
              clocks[advancedCpuIndex].max = null;
              set_value(CLOCK_MIN_MAX_CPU, clocks);
              backend.resolve(backend.unsetCpuClockLimits(advancedCpuIndex), (_idc: any[]) => {
                reloadGUI("CPUUnsetFreq");
              });
            }
          }}
        />
      </PanelSectionRow>}
      {advancedMode && <PanelSectionRow>
        {get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].min != null && <SliderField
          label="Minimum (MHz)"
          value={get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].min}
          max={3500}
          min={1400}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].min == null}
          onChange={(freq: number) => {
            console.debug("Min freq slider for " + advancedCpu.toString() + " is now " + freq.toString());
            const freqNow = get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex] as MinMax;
            if (freq != freqNow.min) {
              backend.resolve(backend.setCpuClockLimits(advancedCpuIndex, freq, freqNow.max!),
                                (limits: number[]) => {
                const clocks = get_value(CLOCK_MIN_MAX_CPU) as MinMax[];
                clocks[advancedCpuIndex].min = limits[0];
                clocks[advancedCpuIndex].max = limits[1];
                set_value(CLOCK_MIN_MAX_CPU, clocks);
                reloadGUI("CPUMinFreq");
              });
            }
          }}
        />}
      </PanelSectionRow>}
      {advancedMode && <PanelSectionRow>
        {get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].max != null && <SliderField
          label="Maximum (MHz)"
          value={get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].max}
          max={3500}
          min={500}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex].max == null}
          onChange={(freq: number) => {
            console.debug("Max freq slider for " + advancedCpu.toString() + " is now " + freq.toString());
            const freqNow = get_value(CLOCK_MIN_MAX_CPU)[advancedCpuIndex] as MinMax;
            if (freq != freqNow.max) {
              backend.resolve(backend.setCpuClockLimits(advancedCpuIndex, freqNow.min!, freq),
                              (limits: number[]) => {
                const clocks = get_value(CLOCK_MIN_MAX_CPU) as MinMax[];
                clocks[advancedCpuIndex].min = limits[0];
                clocks[advancedCpuIndex].max = limits[1];
                set_value(CLOCK_MIN_MAX_CPU, clocks);
                reloadGUI("CPUMaxFreq");
              });
            }
          }}
        />}
      </PanelSectionRow>}
      {advancedMode && <PanelSectionRow>
        <Field
          label="Governor"
        >
          <Dropdown
            menuLabel="Governor"
            rgOptions={governorOptions}
            selectedOption={governorOptions.find((val: SingleDropdownOption, _index, _arr) => {
              console.debug("POWERTOOLS: array item", val);
              console.debug("POWERTOOLS: looking for data", get_value(GOVERNOR_CPU)[advancedCpuIndex]);
              return val.data == get_value(GOVERNOR_CPU)[advancedCpuIndex];
            })}
            strDefaultLabel={get_value(GOVERNOR_CPU)[advancedCpuIndex]}
            onChange={(elem: SingleDropdownOption) => {
              console.debug("Governor dropdown selected", elem);
              backend.resolve(backend.setCpuGovernor(advancedCpuIndex, elem.data as string), (gov: string) => {
                const governors = get_value(GOVERNOR_CPU);
                governors[advancedCpuIndex] = gov;
                set_value(GOVERNOR_CPU, governors);
                reloadGUI("CPUGovernor");
              });
            }}
          />
        </Field>
      </PanelSectionRow>}
      {/* GPU */}
      <div className={staticClasses.PanelSectionTitle}>
        GPU
      </div>
      <PanelSectionRow>
        <ToggleField
          checked={get_value(SLOW_PPT_GPU) != null && get_value(FAST_PPT_GPU) != null}
          label="PowerPlay Limits"
          description="Override APU TDP settings"
          onChange={(value: boolean) => {
            if (value) {
              set_value(SLOW_PPT_GPU, 15000000);
              set_value(FAST_PPT_GPU, 15000000);
              reloadGUI("GPUPPTToggle");
            } else {
              set_value(SLOW_PPT_GPU, null);
              set_value(FAST_PPT_GPU, null);
              backend.resolve(backend.unsetGpuPpt(), (_: any[]) => {
                reloadGUI("GPUUnsetPPT");
              });
            }
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        { get_value(SLOW_PPT_GPU) != null && <SliderField
          label="SlowPPT (uW)"
          value={get_value(SLOW_PPT_GPU)}
          max={29000000}
          min={1000000}
          step={1000000}
          showValue={true}
          disabled={get_value(SLOW_PPT_GPU) == null}
          onChange={(ppt: number) => {
            console.debug("SlowPPT is now " + ppt.toString());
            const pptNow = get_value(SLOW_PPT_GPU);
            if (ppt != pptNow) {
              backend.resolve(backend.setGpuPpt(get_value(FAST_PPT_GPU), ppt),
                              (limits: number[]) => {
                set_value(FAST_PPT_GPU, limits[0]);
                set_value(SLOW_PPT_GPU, limits[1]);
                reloadGUI("GPUSlowPPT");
              });
            }
          }}
        />}
      </PanelSectionRow>
      <PanelSectionRow>
        {get_value(FAST_PPT_GPU) != null && <SliderField
          label="FastPPT (uW)"
          value={get_value(FAST_PPT_GPU)}
          max={29000000}
          min={1000000}
          step={1000000}
          showValue={true}
          disabled={get_value(FAST_PPT_GPU) == null}
          onChange={(ppt: number) => {
            console.debug("FastPPT is now " + ppt.toString());
            const pptNow = get_value(FAST_PPT_GPU);
            if (ppt != pptNow) {
              backend.resolve(backend.setGpuPpt(get_value(SLOW_PPT_GPU), ppt),
                              (limits: number[]) => {
                set_value(FAST_PPT_GPU, limits[0]);
                set_value(SLOW_PPT_GPU, limits[1]);
                reloadGUI("GPUFastPPT");
              });
            }
          }}
        />}
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          checked={get_value(CLOCK_MIN_GPU) != null && get_value(CLOCK_MAX_GPU) != null}
          label="Frequency Limits"
          description="Override bounds on gpu clock"
          onChange={(value: boolean) => {
            if (value) {
              set_value(CLOCK_MIN_GPU, 200);
              set_value(CLOCK_MAX_GPU, 1600);
              reloadGUI("GPUFreqToggle");
            } else {
              set_value(CLOCK_MIN_GPU, null);
              set_value(CLOCK_MAX_GPU, null);
              backend.resolve(backend.unsetGpuClockLimits(), (_: any[]) => {
                reloadGUI("GPUUnsetFreq");
              });
            }
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        { get_value(CLOCK_MIN_GPU) != null && <SliderField
          label="Minimum (MHz)"
          value={get_value(CLOCK_MIN_GPU)}
          max={1600}
          min={200}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MIN_GPU) == null}
          onChange={(val: number) => {
            console.debug("GPU Clock Min is now " + val.toString());
            const valNow = get_value(CLOCK_MIN_GPU);
            if (val != valNow) {
              backend.resolve(backend.setGpuClockLimits(val, get_value(CLOCK_MAX_GPU)),
                              (limits: number[]) => {
                set_value(CLOCK_MIN_GPU, limits[0]);
                set_value(CLOCK_MAX_GPU, limits[1]);
                reloadGUI("GPUMinClock");
              });
            }
          }}
        />}
      </PanelSectionRow>
      <PanelSectionRow>
        {get_value(CLOCK_MAX_GPU) != null && <SliderField
          label="Maximum (MHz)"
          value={get_value(CLOCK_MAX_GPU)}
          max={1600}
          min={200}
          step={100}
          showValue={true}
          disabled={get_value(CLOCK_MAX_GPU) == null}
          onChange={(val: number) => {
            console.debug("GPU Clock Max is now " + val.toString());
            const valNow = get_value(CLOCK_MAX_GPU);
            if (val != valNow) {
              backend.resolve(backend.setGpuClockLimits(get_value(CLOCK_MIN_GPU), val),
                              (limits: number[]) => {
                set_value(CLOCK_MIN_GPU, limits[0]);
                set_value(CLOCK_MAX_GPU, limits[1]);
                reloadGUI("GPUMaxClock");
              });
            }
          }}
        />}
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          checked={get_value(SLOW_MEMORY_GPU)}
          label="Downclock Memory"
          description="Force RAM into low-power mode"
          onChange={(value: boolean) => {
            backend.resolve(backend.setGpuSlowMemory(value), (val: boolean) => {
              set_value(SLOW_MEMORY_GPU, val);
              reloadGUI("GPUSlowMemory");
            })
          }}
        />
      </PanelSectionRow>
      {/* Battery */}
      <div className={staticClasses.PanelSectionTitle}>
        Battery
      </div>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Now (Charge)
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {get_value(CHARGE_NOW_BATT).toFixed(1)} Wh ({(100 * get_value(CHARGE_NOW_BATT) / get_value(CHARGE_FULL_BATT)).toFixed(1)}%)
            </div>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Max (Design)
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {get_value(CHARGE_FULL_BATT).toFixed(1)} Wh ({(100 * get_value(CHARGE_FULL_BATT) / get_value(CHARGE_DESIGN_BATT)).toFixed(1)}%)
            </div>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          checked={get_value(CHARGE_RATE_BATT) != null}
          label="Charge Current Limits"
          description="Control battery charge rate when awake"
          onChange={(value: boolean) => {
            if (value) {
              set_value(CHARGE_RATE_BATT, 2500);
              reloadGUI("BATTChargeRateToggle");
            } else {
              set_value(CHARGE_RATE_BATT, null);
              backend.resolve(backend.unsetBatteryChargeRate(), (_: any[]) => {
                reloadGUI("BATTUnsetChargeRate");
              });
            }
          }}
        />
        { get_value(CHARGE_RATE_BATT) != null && <SliderField
          label="Maximum (mA)"
          value={get_value(CHARGE_RATE_BATT)}
          max={2500}
          min={250}
          step={50}
          showValue={true}
          disabled={get_value(CHARGE_RATE_BATT) == null}
          onChange={(val: number) => {
            console.debug("Charge rate is now " + val.toString());
            const rateNow = get_value(CHARGE_RATE_BATT);
            if (val != rateNow) {
              backend.resolve(backend.setBatteryChargeRate(val),
                              (rate: number) => {
                set_value(CHARGE_RATE_BATT, rate);
                reloadGUI("BATTChargeRate");
              });
            }
          }}
        />}
      </PanelSectionRow>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Current
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {get_value(CURRENT_BATT)} mA
            </div>
          </div>
        </div>
      </PanelSectionRow>
      {/* Persistence */}
      <div className={staticClasses.PanelSectionTitle}>
        Miscellaneous
      </div>
      <PanelSectionRow>
        <ToggleField
          checked={get_value(PERSISTENT_GEN)}
          label="Persistent"
          description="Save profile and load it next time"
          onChange={(persist: boolean) => {
            console.debug("Persist is now " + persist.toString());
            backend.resolve(
              backend.setGeneralPersistent(persist),
              (val: boolean) => {set_value(PERSISTENT_GEN, val)}
            );
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Profile
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {get_value(NAME_GEN)}
            </div>
          </div>
        </div>
      </PanelSectionRow>
      {/* Version Info */}
      <div className={staticClasses.PanelSectionTitle}>
        Debug
      </div>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Native
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {get_value(BACKEND_INFO)}
            </div>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            Framework
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            {target_usdpl()}
            </div>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div className={FieldWithSeparator}>
          <div className={gamepadDialogClasses.FieldLabelRow}>
            <div className={gamepadDialogClasses.FieldLabel}>
            USDPL
            </div>
            <div className={gamepadDialogClasses.FieldChildren}>
            v{version_usdpl()}
            </div>
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={(_: MouseEvent) => {
            console.debug("Loading default PowerTools settings");
            backend.resolve(
              backend.setGeneralPersistent(false),
              (val: boolean) => {
                set_value(PERSISTENT_GEN, val);
                backend.resolve(backend.loadGeneralSystemSettings(), (_) => {
                  reload();
                  backend.resolve(backend.waitForComplete(), (_) => {reloadGUI("LoadSystemDefaults")});
                });
              }
            );
          }}
        >
        Defaults
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  return {
    title: <div className={staticClasses.Title}>PowerTools</div>,
    content: <Content serverAPI={serverApi} />,
    icon: <GiDrill />,
    onDismount() {
      console.debug("PowerTools shutting down");
      clearInterval(periodicHook!);
      periodicHook = null;
      lifetimeHook!.unregister();
      startHook!.unregister();
      serverApi.routerHook.removeRoute("/decky-plugin-test");
      console.debug("Unregistered PowerTools callbacks, goodbye.");
    },
  };
});
