export default function Maintenance() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        color: "#fff",
        textAlign: "center",
        padding: "20px",
      }}
    >
      <style>{`
        @font-face {
          font-family: 'Moderniz';
          src: url('/fonts/Moderniz.woff2') format('woff2');
          font-weight: normal;
          font-style: normal;
        }
      `}</style>
      <div style={{ maxWidth: 600 }}>
        <h1
          style={{
            fontFamily: "'Moderniz', sans-serif",
            fontWeight: "bold",
            textTransform: "uppercase",
            fontSize: 36,
            marginBottom: 14,
            letterSpacing: "1px",
          }}
        >
          We're Making Some Improvements
        </h1>
        <p
          style={{
            fontFamily: "'Moderniz', sans-serif",
            fontWeight: "bold",
            textTransform: "uppercase",
            color: "#fff",
            fontSize: 16,
            letterSpacing: "0.5px",
          }}
        >
          Wearurway Is Temporarily Down For Maintenance. We'll Be Back Online Shortly. Thanks For Your Patience!
        </p>
      </div>
    </div>
  );
}
