const emailForm = document.querySelector("#email-form");
const codeForm = document.querySelector("#code-form");
const email = document.querySelector("#email");
const code = document.querySelector("#code");
const send = emailForm.querySelector("button");
const verify = codeForm.querySelector("button");
const changeEmail = document.querySelector("#change-email");
const status = document.querySelector("#jokbo-status");
let challengeId;

async function request(action, payload) {
  const response = await fetch(new URL(`../api/jokbo/${action}`, location.href), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("족보 인증 서버에 연결할 수 없어요.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}

async function submit(action) {
  send.disabled = verify.disabled = changeEmail.disabled = true;
  status.textContent = "처리 중이에요…";
  try {
    await action();
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? "족보 인증 서버에 연결할 수 없어요."
      : error.message;
  } finally {
    send.disabled = verify.disabled = changeEmail.disabled = false;
  }
}

send.disabled = false;

emailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(async () => {
    const result = await request("send", { email: email.value });
    challengeId = result.challengeId;
    email.readOnly = true;
    codeForm.hidden = false;
    changeEmail.hidden = false;
    code.value = "";
    send.textContent = "인증번호 다시 받기";
    status.textContent = "등록된 이메일로 인증번호를 보냈어요. 10분 안에 입력해 주세요.";
    code.focus();
  });
});

changeEmail.addEventListener("click", () => {
  challengeId = undefined;
  email.readOnly = false;
  codeForm.hidden = true;
  changeEmail.hidden = true;
  send.textContent = "인증번호 받기";
  status.textContent = "";
  email.focus();
});

codeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(async () => {
    const result = await request("verify", { challengeId, code: code.value });
    status.textContent = "인증되었어요. 노션 자료실을 여는 중이에요.";
    location.assign(result.notionUrl);
  });
});
