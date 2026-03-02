export default function StarRating({
  rating,
  variant = "card",
}: {
  rating: number;
  variant?: "store" | "card";
}) {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i + 1 <= Math.round(rating);
        return variant === "store" ? (
          <span key={i} className={`sp-star ${filled ? "filled" : "empty"}`}>★</span>
        ) : (
          <span key={i} className="sp-card-star">{filled ? "★" : "☆"}</span>
        );
      })}
    </>
  );
}
