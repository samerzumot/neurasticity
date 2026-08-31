import { useState } from "react";
import { AudioLines } from "lucide-react";
import { LiveEegPlot } from "./LiveEegPlot";
import { PlotSeriesSelector } from "./PlotSeriesSelector";
import { displaySmoothingAlpha, smoothDisplayValues } from "../signalProcessing/displaySmoothing";

const bands = ["delta", "theta", "alpha", "smr", "beta", "gamma"];

export function BandPowerMonitorPanel({ latest, history }: { latest: Record<string, number>; history: Record<string, number[]> }) {
  const [selectedBands, setSelectedBands] = useState(["theta"]);
  const [alphas, setAlphas] = useState<Record<string, string>>({});
  const plottedBands = selectedBands.filter((band) => bands.includes(band));
  const displayedLatest = Object.fromEntries(bands.map((band) => {
    const smoothingAlpha = displaySmoothingAlpha(alphas[band] ?? "0");
    const values = smoothDisplayValues(history[band] ?? [], smoothingAlpha);
    return [band, smoothingAlpha > 0 && values.length ? values.at(-1) : latest[band]];
  }));
  const smoothingAlphas = Object.fromEntries(bands.map((band) => [band, displaySmoothingAlpha(alphas[band] ?? "0")]));
  return <section className="panel band-monitor-card">
    <div className="panel-header"><div className="panel-title"><div className="icon-tile"><AudioLines aria-hidden="true" /></div><div><h2>Smoothed Band Powers</h2><p>Each lane and readout uses the service’s input-smoothed absolute band power.</p></div></div><PlotSeriesSelector options={bands} selected={selectedBands} onChange={setSelectedBands} /></div>
    <div className="band-monitor-body"><div className="band-chart-surface"><LiveEegPlot channelNames={plottedBands} history={history} smoothingAlphas={smoothingAlphas} /></div><div className="band-value-grid">{bands.map((band) => <div className="channel-row" key={band}><span className="channel-name">{band === "smr" ? "SMR (12–15 Hz)" : band}</span><strong>{formatPower(displayedLatest[band])}</strong><label className="band-alpha-input">α = <input aria-label={`${band} smoothing alpha`} type="number" min="0" max="1" step="0.01" inputMode="decimal" value={alphas[band] ?? "0"} onChange={(event) => setAlphas((current) => ({ ...current, [band]: event.target.value }))} /></label></div>)}</div></div>
  </section>;
}

function formatPower(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) ? value.toPrecision(3) : "--"; }
