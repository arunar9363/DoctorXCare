import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, MapPin } from "lucide-react";
import { diseaseLookupPath, loadDiseaseCatalog } from "../../services/diseaseLibrary";

export default function AssessmentServiceLinks({ conditions }) {
  const [catalog, setCatalog] = useState([]);
  const hasConditions = conditions.length > 0;

  useEffect(() => {
    if (!hasConditions) return;
    const controller = new AbortController();
    loadDiseaseCatalog(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch(() => {
        // The library search remains available when the catalog cannot be read here.
      });
    return () => controller.abort();
  }, [hasConditions]);

  const singleCondition = conditions.length === 1 ? conditions[0].name : "";

  return (
    <section className="symptom-assessment__services" aria-labelledby="assessment-services-heading">
      <h3 id="assessment-services-heading">Related services</h3>
      <div className="symptom-assessment__services-grid">
        <Link className="symptom-assessment__service-link" to={diseaseLookupPath(catalog, singleCondition)}
          target="_blank" rel="noopener noreferrer">
          <BookOpen size={21} aria-hidden="true" />
          <span>
            {singleCondition ? "Look up in Disease Library" : "Browse Disease Library"}
            {singleCondition && <small>{singleCondition}</small>}
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </Link>
        <Link className="symptom-assessment__service-link" to="/healthcare-network"
          target="_blank" rel="noopener noreferrer">
          <MapPin size={21} aria-hidden="true" />
          <span>Find nearby hospitals</span>
          <ArrowUpRight size={16} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </Link>
      </div>
      {conditions.length > 1 && (
        <ul className="symptom-assessment__condition-links" aria-label="Possible causes to look up">
          {conditions.map(({ name }, index) => (
            <li key={index}>
              <Link to={diseaseLookupPath(catalog, name)} target="_blank" rel="noopener noreferrer"
                aria-label={"Look up " + name + " in the Disease Library. Opens in a new tab."}>
                {name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
