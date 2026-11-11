import { getLearningModuleSequenceNumber, type LearningModuleDefinition } from "../learningModules";

export function ModuleGuideView({ module }: { module: LearningModuleDefinition }): JSX.Element {
  return (
    <article aria-labelledby="module-guide-title" className="module-guide">
      <header className="module-guide-heading">
        <span className="module-kicker">
          LEVEL {getLearningModuleSequenceNumber(module.id)} · 学习导读
        </span>
        <h2 id="module-guide-title">{module.guide.title}</h2>
        <p>{module.summary}</p>
      </header>

      <aside aria-label="本阶段达标建议" className="module-guide-graduation">
        <strong>达标建议</strong>
        <p>{module.graduationCriteria.description}</p>
      </aside>

      <div className="module-guide-grid">
        <section className="module-guide-card">
          <span>本阶段目标</span>
          <h3>{module.guide.goal}</h3>
        </section>
        {module.guide.methods?.length ? (
          <section
            aria-labelledby="module-guide-methods-title"
            className="module-guide-card module-guide-methods"
          >
            <span id="module-guide-methods-title">盲弹定位方法</span>
            <div className="module-guide-method-list">
              {module.guide.methods.map((method) => (
                <section className="module-guide-method" key={method.title}>
                  <h3>{method.title}</h3>
                  <p>{method.description}</p>
                </section>
              ))}
            </div>
          </section>
        ) : (
          <section className="module-guide-card">
            <span>为什么这样练</span>
            <p>{module.guide.principle}</p>
          </section>
        )}
      </div>

      <aside aria-label="练习要点" className="module-guide-highlight">
        <strong>练习要点</strong>
        <p>{module.guide.highlight}</p>
      </aside>

      <section aria-labelledby="module-guide-steps-title" className="module-guide-steps">
        <h3 id="module-guide-steps-title">练习时留意</h3>
        <ol>
          {module.guide.steps.map((step, index) => (
            <li key={step}>
              <span aria-hidden="true">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
