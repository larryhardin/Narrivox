import { useState } from "react";

function patternFor(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return String(hash % 4);
}

export function CoverArt({ title, src }: { title: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = title.trim().charAt(0).toUpperCase() || "N";
  return (
    <div className="cover-frame">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="monogram" data-pattern={patternFor(title)}>
          <span>{letter}</span>
        </div>
      )}
    </div>
  );
}
