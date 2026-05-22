import { computed, ref } from "vue";
import {
  autopilotQuestionAnswersPrompt
} from "@/lib/aiStudioAutopilotPromptFiles.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function normalizeQuestion(value = {}, index = 0) {
  const text = String(typeof value === "string" ? value : value.text || value.question || "").trim();
  if (!text) {
    return null;
  }
  return {
    answer: String(value.answer || ""),
    id: String(value.id || `q${index + 1}`),
    text
  };
}

function normalizeQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : [])
    .map(normalizeQuestion)
    .filter(Boolean);
}

function defaultAnswerPrompt(exchange = {}, questions = []) {
  return autopilotQuestionAnswersPrompt({
    contextLabel: exchange.contextLabel,
    continuationLines: exchange.continuationLines,
    questions
  });
}

function useAiStudioCodexQuestionExchange({
  codexTerminal = {}
} = {}) {
  const activeExchange = ref(null);
  const failure = ref("");
  const submitting = ref(false);

  const codexActive = computed(() => readRefOrGetterValue(codexTerminal?.busy) === true ||
    readRefOrGetterValue(codexTerminal?.working) === true);
  const ownerId = computed(() => String(activeExchange.value?.ownerId || ""));
  const questions = computed(() => activeExchange.value?.questions || []);
  const hasQuestions = computed(() => questions.value.length > 0);
  const canSubmit = computed(() => Boolean(
    hasQuestions.value &&
    !codexActive.value &&
    !submitting.value &&
    questions.value.every((question) => String(question.answer || "").trim())
  ));

  function isOwner(nextOwnerId = "") {
    return Boolean(nextOwnerId && ownerId.value === String(nextOwnerId));
  }

  function start(input = {}) {
    const normalizedQuestions = normalizeQuestions(input.questions);
    if (normalizedQuestions.length <= 0) {
      clear();
      return false;
    }

    activeExchange.value = {
      buildAnswerPrompt: typeof input.buildAnswerPrompt === "function" ? input.buildAnswerPrompt : null,
      contextLabel: String(input.contextLabel || "Current Codex task"),
      continuationLines: Array.isArray(input.continuationLines) ? input.continuationLines : [],
      injectionContext: input.injectionContext && typeof input.injectionContext === "object"
        ? input.injectionContext
        : {},
      onAnswerChange: typeof input.onAnswerChange === "function" ? input.onAnswerChange : null,
      onCancel: typeof input.onCancel === "function" ? input.onCancel : null,
      onSubmitFailed: typeof input.onSubmitFailed === "function" ? input.onSubmitFailed : null,
      onSubmitted: typeof input.onSubmitted === "function" ? input.onSubmitted : null,
      ownerId: String(input.ownerId || ""),
      prepareSubmit: typeof input.prepareSubmit === "function" ? input.prepareSubmit : null,
      questions: normalizedQuestions,
      submitFailureMessage: String(input.submitFailureMessage || "Codex could not receive the clarification answers.")
    };
    failure.value = "";
    submitting.value = false;
    return true;
  }

  function clear() {
    activeExchange.value = null;
    failure.value = "";
    submitting.value = false;
  }

  function clearForOwner(nextOwnerId = "") {
    if (isOwner(nextOwnerId)) {
      clear();
    }
  }

  function clearFailure() {
    failure.value = "";
  }

  function setAnswer(questionId = "", answer = "") {
    if (!activeExchange.value) {
      return;
    }

    const nextQuestions = questions.value.map((question) => {
      if (question.id !== questionId) {
        return question;
      }
      return {
        ...question,
        answer: String(answer || "")
      };
    });
    activeExchange.value = {
      ...activeExchange.value,
      questions: nextQuestions
    };
    activeExchange.value.onAnswerChange?.(nextQuestions);
  }

  function cancel() {
    const exchange = activeExchange.value;
    if (!exchange) {
      return;
    }
    clear();
    exchange.onCancel?.(exchange);
  }

  async function submitAnswers() {
    const exchange = activeExchange.value;
    if (!exchange) {
      return {
        ok: false,
        reason: "inactive"
      };
    }
    if (!canSubmit.value) {
      failure.value = codexActive.value
        ? "Codex is already working in this session. Wait for it to finish before sending answers."
        : "Answer each question before continuing.";
      return {
        ok: false,
        reason: codexActive.value ? "codex_active" : "incomplete"
      };
    }

    const answeredQuestions = questions.value.map((question) => ({
      ...question
    }));
    const currentExchange = {
      ...exchange,
      questions: answeredQuestions
    };

    submitting.value = true;
    failure.value = "";
    try {
      const prepared = await currentExchange.prepareSubmit?.({
        exchange: currentExchange,
        questions: answeredQuestions
      }) || {};
      const prompt = String(
        prepared.prompt ||
        currentExchange.buildAnswerPrompt?.({
          exchange: currentExchange,
          prepared,
          questions: answeredQuestions
        }) ||
        defaultAnswerPrompt(currentExchange, answeredQuestions)
      ).trim();
      const context = {
        ...currentExchange.injectionContext,
        ...(prepared.injectionContext || {})
      };
      const terminal = prepared.codexTerminal || codexTerminal;
      if (typeof terminal.injectPrompt !== "function") {
        throw new Error("Codex prompt injection is not available.");
      }
      const injected = await terminal.injectPrompt(prompt, context);
      if (injected === false) {
        throw new Error("Codex did not accept the clarification answers.");
      }

      clear();
      await currentExchange.onSubmitted?.({
        exchange: currentExchange,
        prepared,
        prompt,
        questions: answeredQuestions
      });
      return {
        exchange: currentExchange,
        ok: true,
        prepared,
        questions: answeredQuestions
      };
    } catch (error) {
      activeExchange.value = currentExchange;
      failure.value = String(error?.message || error || currentExchange.submitFailureMessage);
      await currentExchange.onSubmitFailed?.({
        error,
        exchange: currentExchange,
        questions: answeredQuestions
      });
      return {
        error,
        exchange: currentExchange,
        ok: false,
        questions: answeredQuestions
      };
    } finally {
      submitting.value = false;
    }
  }

  return {
    canSubmit,
    cancel,
    clear,
    clearFailure,
    clearForOwner,
    failure,
    hasQuestions,
    isOwner,
    ownerId,
    questions,
    setAnswer,
    start,
    submitAnswers,
    submitting
  };
}

export {
  useAiStudioCodexQuestionExchange
};
