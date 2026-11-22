import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart,
   Line, AreaChart,
   Area,
   XAxis,
   YAxis,
   CartesianGrid,
   Tooltip,
   Legend,
   ResponsiveContainer
  } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Calendar } from 'lucide-react';

const Charts = ({
  patientData,
  metricType = 'blood_pressure',
  timeRange = 30
}) => {
  const [selectedTimeRange, setSelectedTimeRange] = useState(timeRange);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const chartRef = useRef(null);

  // Check theme
  useEffect(() => {
    const checkTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDarkMode(theme === 'dark');
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const { chartData, statistics, trendDirection, displayUnit, mixedUnits } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - selectedTimeRange);
    const dated = (patientData || []).filter(item => new Date(item.date) >= cutoff)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const isPressure = metricType === "blood_pressure";
    const displayUnit = isPressure ? "mmHg" : dated.at(-1)?.unit;
    const comparable = isPressure ? dated : dated.filter(item => item.unit === displayUnit);
    const chartData = comparable.map(item => ({
      ...item,
      date: new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    }));
    const average = values => values.reduce((a, b) => a + b, 0) / values.length;
    const values = comparable.map(item => isPressure ? item.systolic : item.value);
    const diastolic = isPressure ? comparable.map(item => item.diastolic) : [];
    let statistics = {};
    if (values.length) {
      statistics = isPressure ? {
        systolicAvg: average(values).toFixed(1), systolicMin: Math.min(...values), systolicMax: Math.max(...values),
        diastolicAvg: average(diastolic).toFixed(1), diastolicMin: Math.min(...diastolic), diastolicMax: Math.max(...diastolic),
      } : { average: average(values).toFixed(1), min: Math.min(...values), max: Math.max(...values), latest: values.at(-1) };
    }
    let trendDirection = "insufficient";
    if (values.length >= 2) {
      const half = Math.floor(values.length / 2);
      const first = average(values.slice(0, half));
      const change = average(values.slice(half)) - first;
      trendDirection = change === 0 || Math.abs(change) < Math.abs(first) * 0.03
        ? "stable" : (change > 0 ? "increasing" : "decreasing");
    }
    return { chartData, statistics, trendDirection, displayUnit, mixedUnits: comparable.length !== dated.length };
  }, [patientData, metricType, selectedTimeRange]);

  const getTrendIcon = () => {
    switch (trendDirection) {
      case 'decreasing':
        return <TrendingDown className="text-blue-500" size={24} />;
      case 'increasing':
        return <TrendingUp className="text-blue-500" size={24} />;
      case 'stable':
        return <Activity className="text-blue-500" size={24} />;
      default:
        return <Activity className="text-gray-500" size={24} />;
    }
  };

  const getTrendColor = () => {
    switch (trendDirection) {
      case 'decreasing':
        return '#3b82f6';
      case 'increasing':
        return '#3b82f6';
      case 'stable':
        return '#3b82f6';
      default:
        return '#6b7280';
    }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
          border: `1px solid ${isDarkMode ? '#334155' : '#e5e7eb'}`,
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
          <p style={{
            fontWeight: '600',
            marginBottom: '8px',
            color: isDarkMode ? '#f3f4f6' : '#111827'
          }}>
            {label}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{
              color: entry.color,
              fontSize: '14px',
              margin: '4px 0'
            }}>
              {entry.name}: {entry.value} {entry.unit || ''}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderBloodPressureChart = () => (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={isDarkMode ? '#334155' : '#e5e7eb'}
        />
        <XAxis
          dataKey="date"
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
        />
        <YAxis
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
          label={{
            value: 'mmHg',
            angle: -90,
            position: 'insideLeft',
            style: { fill: isDarkMode ? '#9ca3af' : '#6b7280' }
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{
            paddingTop: '20px',
            color: isDarkMode ? '#f3f4f6' : '#111827'
          }}
        />
        <Line
          type="monotone"
          dataKey="systolic"
          stroke="#ef4444"
          strokeWidth={2}
          dot={{ fill: '#ef4444', r: 4 }}
          activeDot={{ r: 6 }}
          name="Systolic"
        />
        <Line
          type="monotone"
          dataKey="diastolic"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ fill: '#3b82f6', r: 4 }}
          activeDot={{ r: 6 }}
          name="Diastolic"
        />
      </LineChart>
    </ResponsiveContainer>
  );

  const renderGlucoseChart = () => (
    <ResponsiveContainer width="100%" height={400}>
      <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <defs>
          <linearGradient id="glucoseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={isDarkMode ? '#334155' : '#e5e7eb'}
        />
        <XAxis
          dataKey="date"
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
        />
        <YAxis
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
          label={{
            value: displayUnit,
            angle: -90,
            position: 'insideLeft',
            style: { fill: isDarkMode ? '#9ca3af' : '#6b7280' }
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#f59e0b"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#glucoseGradient)"
          name="Blood Glucose"
        />
      </AreaChart>
    </ResponsiveContainer>
  );

  const renderGenericChart = () => (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={isDarkMode ? '#334155' : '#e5e7eb'}
        />
        <XAxis
          dataKey="date"
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
        />
        <YAxis
          stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
          style={{ fontSize: '12px' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#0d9db8"
          strokeWidth={2}
          dot={{ fill: '#0d9db8', r: 4 }}
          activeDot={{ r: 6 }}
          name={metricType.replace('_', ' ').toUpperCase()}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div style={{
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: isDarkMode
        ? '0 4px 6px rgba(0, 0, 0, 0.3)'
        : '0 4px 6px rgba(0, 0, 0, 0.1)',
      border: isDarkMode ? '1px solid #334155' : '1px solid #e5e7eb'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {getTrendIcon()}
          <div>
            <h3 style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              color: isDarkMode ? '#f3f4f6' : '#111827',
              margin: 0
            }}>
              {metricType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Trend
            </h3>
            <p style={{
              fontSize: '0.875rem',
              color: getTrendColor(),
              fontWeight: '600',
              margin: '4px 0 0 0'
            }}>
              {trendDirection === 'decreasing' && 'Decreasing'}
              {trendDirection === 'increasing' && 'Increasing'}
              {trendDirection === 'stable' && 'Stable'}
              {trendDirection === 'insufficient' && 'Insufficient Data'}
            </p>
          </div>
        </div>

        {/* Time Range Selector */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Calendar size={18} style={{ color: isDarkMode ? '#9ca3af' : '#6b7280' }} />
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(parseInt(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: isDarkMode ? '1px solid #334155' : '1px solid #d1d5db',
              backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb',
              color: isDarkMode ? '#f3f4f6' : '#111827',
              fontSize: '0.875rem',
              cursor: 'pointer'
            }}
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* Statistics Cards */}
      {metricType === 'blood_pressure' && statistics.systolicAvg && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '12px',
          marginBottom: '24px'
        }}>
          <div style={{
            backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            border: isDarkMode ? '1px solid #334155' : '1px solid #e5e7eb'
          }}>
            <p style={{
              fontSize: '0.75rem',
              color: isDarkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Avg Systolic
            </p>
            <p style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: '#ef4444',
              margin: 0
            }}>
              {statistics.systolicAvg}
            </p>
          </div>
          <div style={{
            backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            border: isDarkMode ? '1px solid #334155' : '1px solid #e5e7eb'
          }}>
            <p style={{
              fontSize: '0.75rem',
              color: isDarkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Avg Diastolic
            </p>
            <p style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: '#3b82f6',
              margin: 0
            }}>
              {statistics.diastolicAvg}
            </p>
          </div>
        </div>
      )}

      {metricType !== 'blood_pressure' && statistics.average && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '12px',
          marginBottom: '24px'
        }}>
          <div style={{
            backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            border: isDarkMode ? '1px solid #334155' : '1px solid #e5e7eb'
          }}>
            <p style={{
              fontSize: '0.75rem',
              color: isDarkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '4px',
              textTransform: 'uppercase'
            }}>
              Average
            </p>
            <p style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: '#0d9db8',
              margin: 0
            }}>
              {statistics.average}
            </p>
          </div>
          <div style={{
            backgroundColor: isDarkMode ? '#0f172a' : '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            border: isDarkMode ? '1px solid #334155' : '1px solid #e5e7eb'
          }}>
            <p style={{
              fontSize: '0.75rem',
              color: isDarkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '4px',
              textTransform: 'uppercase'
            }}>
              Range
            </p>
            <p style={{
              fontSize: '1rem',
              fontWeight: '600',
              color: isDarkMode ? '#f3f4f6' : '#111827',
              margin: 0
            }}>
              {statistics.min} - {statistics.max}
            </p>
          </div>
        </div>
      )}

      {mixedUnits && <p>Chart and statistics show readings in {displayUnit}.</p>}

      {/* Chart */}
      <div ref={chartRef}>
        {chartData.length === 0 ? (
          <div style={{
            height: '400px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isDarkMode ? '#9ca3af' : '#6b7280'
          }}>
            <p>No data available for the selected time range</p>
          </div>
        ) : (
          <>
            {metricType === 'blood_pressure' && renderBloodPressureChart()}
            {metricType === 'blood_glucose' && renderGlucoseChart()}
            {metricType !== 'blood_pressure' && metricType !== 'blood_glucose' && renderGenericChart()}
          </>
        )}
      </div>
    </div>
  );
};

export default Charts;