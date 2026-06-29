export default function Maintenance() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        color: "#fff",
        textAlign: "center",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        html, body, #root {
          margin: 0;
          padding: 0;
          height: 100%;
          background: #000000 !important;
        }
        @font-face {
          font-family: 'Moderniz';
          src: url('/fonts/Moderniz.woff2') format('woff2');
          font-weight: normal;
          font-style: normal;
        }
      `}</style>
      <div style={{ maxWidth: 600, width: "100%" }}>
        <h1
          style={{
            fontFamily: "'Moderniz', sans-serif",
            fontWeight: "bold",
            textTransform: "uppercase",
            fontSize: "clamp(22px, 6vw, 36px)",
            marginBottom: 14,
            letterSpacing: "1px",
            lineHeight: 1.2,
            wordBreak: "break-word",
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
            fontSize: "clamp(13px, 3.5vw, 16px)",
            letterSpacing: "0.5px",
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          Wearurway Is Temporarily Down For Maintenance. We'll Be Back Online Shortly. Thanks For Your Patience!
        </p>
      </div>
    </div>
  );
}
