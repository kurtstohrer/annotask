const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '60px 0',
  gap: '20px',
}

const orbitContainerStyle: React.CSSProperties = {
  position: 'relative',
  width: '80px',
  height: '80px',
}

const planetStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '24px',
  height: '24px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)',
}

const orbitRingStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  border: '1px solid rgba(148, 163, 184, 0.2)',
}

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#94a3b8',
  letterSpacing: '0.05em',
}

function LoadingOrbit() {
  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes orbit {
          from { transform: translate(-50%, -50%) rotate(0deg) translateX(32px) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg) translateX(32px) rotate(-360deg); }
        }
      `}</style>
      <div style={orbitContainerStyle}>
        <div style={orbitRingStyle} />
        <div style={planetStyle} />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)',
            animation: 'orbit 2s linear infinite',
          }}
        />
      </div>
      <span style={labelStyle}>Loading…</span>
    </div>
  )
}

export default LoadingOrbit
