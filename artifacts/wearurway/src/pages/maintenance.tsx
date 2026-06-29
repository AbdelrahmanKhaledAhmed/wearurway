export default function Maintenance() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111",
        color: "#fff",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        padding: "20px",
      }}
    >
      <div style={{ maxWidth: 500 }}>
        <h1 style={{ fontSize: 28, marginBottom: 10 }}>
          We're making some improvements
        </h1>
        <p style={{ color: "#aaa", fontSize: 16 }}>
          Wearurway is temporarily down for maintenance. We'll be back online shortly. Thanks for your patience!
        </p>
      </div>
    </div>
  );
}
