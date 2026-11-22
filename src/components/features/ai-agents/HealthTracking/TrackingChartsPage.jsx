import { Link, useSearchParams } from "react-router-dom";
import useHealthReadings from "../../../../hooks/useHealthReadings";
import Charts from "./Charts";

const labels = {
  blood_pressure: "Blood pressure",
  blood_glucose: "Blood glucose",
  heart_rate: "Heart rate",
  weight: "Weight",
  oxygen_saturation: "Oxygen saturation",
  tsh: "TSH",
  t3: "T3",
  t4: "T4",
};

export default function TrackingChartsPage() {
  const [query, setQuery] = useSearchParams();
  const requested = query.get("metric");
  const metric = Object.hasOwn(labels, requested) ? requested : "blood_pressure";
  const { healthData, readingsLoading, readingsError } = useHealthReadings();

  return (
    <main className="container py-4">
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <Link to="/health-tracking/dashboard">Back to health tracker</Link>
        <label className="d-flex align-items-center gap-2">
          Metric
          <select className="form-select" value={metric} onChange={event => setQuery({ metric: event.target.value })}>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {readingsLoading && <p role="status">Loading saved readings...</p>}
      {readingsError && <p role="alert">{readingsError}</p>}
      {!readingsLoading && !readingsError && <Charts key={metric} patientData={healthData[metric]} metricType={metric} />}
    </main>
  );
}
