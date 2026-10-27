import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import './styles.css';

/* ==========================================================================
   LT360 — Portal do Aluno (v1 integrada)
   Visual LT360 aprovado + dados REAIS do Supabase onde existem.
   O que é mock (marcado): disponibilidade/solicitações (Fase 3), cobranças
   (Fase 4), e os blocos "Meu progresso" e, quando não há aulas concluídas,
   "Últimas atividades". Tudo o mais vem do banco sob RLS de aluno.
   Campos ainda inexistentes no schema de aulas (título, tipo e local do
   treino) usam valores padrão — adicioná-los como colunas no futuro restaura
   a riqueza total dos cartões.
   ========================================================================== */
(function(){
  "use strict";

  // PWA: registra o service worker (instalável + offline básico).
  if ("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw.js").catch(function(e){ console.warn("SW não registrado:", e); });
    });
  }

  var DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
  var MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
  function doisDig(n){ return (n<10?"0":"")+n; }
  function dataLocalStr(d){ return d.getFullYear()+"-"+doisDig(d.getMonth()+1)+"-"+doisDig(d.getDate()); }
  function fmtDataBR(iso){ var p=iso.split("-"); return p[2]+"/"+p[1]+"/"+p[0]; }
  function diaSemanaLabel(iso){ return DIAS[new Date(iso+"T00:00:00").getDay()]; }
  function dataLongaBR(d){ return capitalizar(DIAS[d.getDay()])+", "+d.getDate()+" de "+MESES[d.getMonth()]+" de "+d.getFullYear(); }
  function iniciais(nome){ var p=(nome||"").trim().split(/\s+/); if(!p[0])return"A"; return (p[0][0]+(p[1]?p[1][0]:"")).toUpperCase(); }
  function avatarInner(){ return meuFotoUrl ? '<img class="avatar-img" src="'+meuFotoUrl+'" alt="">' : iniciais(meuNome); }
  // Marca exibida no portal: logo do personal (se houver) ou a LT360.
  function brandLogo(extraCls){
    return logoPersonal
      ? '<img class="logo-img '+(extraCls||'')+' logo-custom" src="'+logoPersonal+'" alt="'+nomePersonal+'">'
      : '<img class="logo-img '+(extraCls||'')+'" src="/logo_lt360.png" alt="LT360">';
  }
  function logoPersonalBox(){
    return logoPersonal
      ? '<span class="avatar avatar-foto logo-av"><img class="logo-av-img" src="'+logoPersonal+'" alt=""></span>'
      : '<span class="avatar avatar-foto">'+iniciais(nomePersonal)+'</span>';
  }
  function toast(msg){
    var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
    clearTimeout(t.__t); t.__t=setTimeout(function(){ t.classList.remove("show"); },2200);
  }
  window.toast = toast;

  var HOJE = new Date();
  var HOJE_STR = dataLocalStr(HOJE);

  /* ---------------- Supabase (auth com lock desativado) ------------------- */
  var SB_URL = import.meta.env.VITE_SUPABASE_URL;
  var SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  var sb = createClient(SB_URL, SB_KEY, {
    auth: { lock: function(name, acquireTimeout, fn){ return fn(); } }
  });

  /* ---------------- Estado (dados reais) ---------------------------------- */
  var meuAlunoId=null, meuProfessorId=null, meuNome="", meuEmail="", meuTelefone="", meuFotoUrl=null;
  var meuTreinoTipo="forca", meuTreinoLocal="", meuCheckinToken="";
  var meuPlanoCobranca="", meuValorAula=0;
  var nomePersonal="Seu personal", logoPersonal=null, pixPersonal="", telefonePersonal="";
  var pixTipoPersonal="", cidadePersonal="";
  var dispPersonal=[]; // disponibilidade do personal: {dia, ini, fim} (dias 0-6)
  var aulas = [];              // reais: {id,data,hora,status}
  var minhasSolicitacoes = []; // reais: {id,aulaId,tipo,dataSugerida,horaSugerida,status,createdAt}
  var minhasCobrancas = [];    // reais: {id,valor,label,status,vencimento,pagamento}
  var tabAtual = "inicio";
  var aulasTab = "proximas";   // sub-aba da tela Aulas
  var agendaSel = HOJE_STR;    // dia selecionado na Agenda
  var agendaAno = HOJE.getFullYear(), agendaMes = HOJE.getMonth(); // mês exibido na Agenda
  var agendaView = "mes";      // mes | semana | lista
  var solicTab = "todas";      // todas | em_analise | aprovada | negada
  var finTab = "cobrancas";    // cobrancas | historico

  /* ---------------- MOCK (marcado) ---------------------------------------- */
  // Solicitações e Financeiro agora são REAIS. Só resta mock o bloco de
  // progresso (peso), que ainda não tem fonte de dados.
  var MOCK = {
    progresso:{ peso:"—", pesoDelta:"", aulasRealizadas:null }
  };
  function fmtMoeda(v){ return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
  var seqSolic = 1;

  /* =========================================================================
     AUTENTICAÇÃO (idêntica à versão validada — não alterar à toa)
     ========================================================================= */
  var authEventJaProcessado=false, sessaoConvite=null;
  function precisaDefinirSenha(session){ var m=session&&session.user&&session.user.user_metadata; return !!(m&&m.must_set_password); }
  function decidirDestino(session){
    if (precisaDefinirSenha(session)){
      sessaoConvite=session;
      document.getElementById("gate-loading").hidden=true;
      document.getElementById("gate-auth").hidden=false;
      mostrarAuthView("convite");
    } else { aposLogin(session); }
  }
  var urlTemAuthPendente = /access_token=|refresh_token=|[?&]code=|type=/.test(window.location.href);
  function resolverEstadoInicial(session){
    if (authEventJaProcessado) return;
    authEventJaProcessado=true;
    if (session){ decidirDestino(session); } else { mostrarGateAuth(); }
  }
  sb.auth.onAuthStateChange(function(event, session){
    if (event==="SIGNED_OUT"){ mostrarGateAuth(); mostrarAuthView("login"); return; }
    if (!authEventJaProcessado && !session && urlTemAuthPendente && event==="INITIAL_SESSION") return;
    resolverEstadoInicial(session);
  });
  if (!urlTemAuthPendente){
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(e){ console.error(e); });
  }
  function mostrarGateAuth(){ document.getElementById("gate-loading").hidden=true; document.getElementById("gate-auth").hidden=false; }
  function mostrarAuthView(nome){
    document.getElementById("authview-login").hidden = nome!=="login";
    document.getElementById("authview-convite").hidden = nome!=="convite";
  }
  function setErro(id,msg){ var e=document.getElementById(id); if(!e)return; e.textContent=msg||""; e.hidden=!msg; }
  window.toggleSenha = function(id){ var i=document.getElementById(id); if(i) i.type=i.type==="password"?"text":"password"; };

  window.entrar = async function(ev){
    ev.preventDefault();
    var email=document.getElementById("login-email").value.trim();
    var senha=document.getElementById("login-senha").value;
    var btn=document.getElementById("login-submit");
    setErro("login-erro","");
    if(!email||!senha){ setErro("login-erro","Informe e-mail e senha."); return; }
    btn.disabled=true; btn.textContent="Entrando...";
    try{ var r=await sb.auth.signInWithPassword({email:email,password:senha}); if(r.error) throw r.error; await aposLogin(r.data.session); }
    catch(err){ setErro("login-erro", traduzErroAuth(err)); btn.disabled=false; btn.textContent="Entrar"; }
  };
  window.definirSenhaConvite = async function(ev){
    ev.preventDefault();
    var senha=document.getElementById("convite-senha").value;
    var conf=document.getElementById("convite-senha-confirma").value;
    var btn=document.getElementById("convite-submit");
    setErro("convite-erro","");
    if(senha.length<6){ setErro("convite-erro","A senha precisa ter pelo menos 6 caracteres."); return; }
    if(senha!==conf){ setErro("convite-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{
      var r=await sb.auth.updateUser({password:senha,data:{must_set_password:false}}); if(r.error) throw r.error;
      var s=await sb.auth.getSession();
      if(!s.data.session) throw new Error("Sessão expirou. Peça um novo convite ao seu personal.");
      await aposLogin(s.data.session,true);
    } catch(err){
      console.error("Erro ao definir senha do convite:",err);
      setErro("convite-erro",(err&&err.message)||"Não foi possível salvar a senha. Peça um novo convite.");
      btn.disabled=false; btn.textContent="Criar senha e entrar";
    }
  };
  function traduzErroAuth(err){
    var m=(err&&err.message)||"Erro ao autenticar.";
    if(/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if(/Email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar.";
    return m;
  }
  async function aposLogin(session, viaConvite){
    if(!viaConvite && precisaDefinirSenha(session)) return;
    try{ await carregarMeusDados(session.user.id); }
    catch(err){
      console.error(err);
      mostrarGateAuth();
      setErro("login-erro","Não consegui carregar seus dados. Tente novamente em alguns minutos.");
      var b=document.getElementById("login-submit"); if(b){ b.disabled=false; b.textContent="Entrar"; }
      var bc=document.getElementById("convite-submit"); if(bc){ bc.disabled=false; bc.textContent="Criar senha e entrar"; }
      return;
    }
    document.getElementById("gate").hidden=true;
    document.getElementById("app").hidden=false;
    document.getElementById("topbar-date").textContent = dataLongaBR(HOJE);
    document.getElementById("btn-bell").innerHTML = IC.bell;
    document.getElementById("topbar-avatar").innerHTML = avatarInner();
    renderShell();
    ir("inicio");
  }

  async function carregarMeusDados(authUserId){
    var alunoRes = await sb.from("alunos").select("id, nome, telefone, professor_id, treino_tipo, treino_local, plano_cobranca, valor_aula, foto_url").eq("auth_user_id", authUserId).maybeSingle();
    if (alunoRes.error) throw alunoRes.error;
    if (!alunoRes.data) throw new Error("Cadastro de aluno não encontrado.");
    meuAlunoId=alunoRes.data.id; meuProfessorId=alunoRes.data.professor_id;
    meuNome=alunoRes.data.nome||""; meuTelefone=alunoRes.data.telefone||"";
    meuFotoUrl=alunoRes.data.foto_url||null;
    meuTreinoTipo=alunoRes.data.treino_tipo||"forca"; meuTreinoLocal=alunoRes.data.treino_local||"";
    meuPlanoCobranca=alunoRes.data.plano_cobranca||""; meuValorAula=Number(alunoRes.data.valor_aula)||0;

    var sess=await sb.auth.getSession();
    meuEmail=(sess.data.session&&sess.data.session.user&&sess.data.session.user.email)||"";

    var res=await Promise.all([
      sb.from("aulas").select("id, data, hora, status, checkin_em, checkin_origem").eq("aluno_id", meuAlunoId),
      sb.from("profiles").select("nome, logo_url, pix, telefone").eq("id", meuProfessorId).maybeSingle()
    ]);
    if(res[0].error) throw res[0].error;
    if(res[1].error) throw res[1].error;
    aulas=(res[0].data||[]).map(function(r){ return {id:r.id,data:r.data,hora:(r.hora||"").slice(0,5),status:r.status,checkinEm:r.checkin_em||null,checkinOrigem:r.checkin_origem||null}; });
    var prof=res[1].data||{};
    nomePersonal=prof.nome||"Seu personal"; logoPersonal=prof.logo_url||null;
    pixPersonal=prof.pix||"(chave PIX não cadastrada)"; telefonePersonal=prof.telefone||"";

    // Solicitações reais (tolerante: se a tabela ainda não existir, não quebra o login).
    try {
      var sres = await sb.from("solicitacoes")
        .select("id, aula_id, tipo, data_sugerida, hora_sugerida, contra_data, contra_hora, status, created_at, resposta")
        .eq("aluno_id", meuAlunoId);
      minhasSolicitacoes = sres.error ? [] : (sres.data||[]).map(rowToSolic);
    } catch(e){ minhasSolicitacoes = []; }

    // Disponibilidade do personal (tolerante): só para exibir como dica ao pedir remarcação.
    try {
      var dres = await sb.from("disponibilidade_personal")
        .select("dia_semana, hora_inicio, hora_fim, ativo").eq("professor_id", meuProfessorId);
      dispPersonal = dres.error ? [] : (dres.data||[]).filter(function(d){return d.ativo!==false;})
        .map(function(d){ return { dia:d.dia_semana, ini:(d.hora_inicio||"").slice(0,5), fim:(d.hora_fim||"").slice(0,5) }; });
    } catch(e){ dispPersonal = []; }

    // Token de check-in (tolerante: só existe após a migração da Fase 5).
    try {
      var tkRes = await sb.from("alunos").select("checkin_token").eq("id", meuAlunoId).maybeSingle();
      meuCheckinToken = (tkRes.error || !tkRes.data) ? "" : (tkRes.data.checkin_token||"");
    } catch(e){ meuCheckinToken = ""; }

    // Tipo da chave Pix + cidade do personal (tolerante: só após a migração 0013).
    try {
      var pxRes = await sb.from("profiles").select("pix_tipo, cidade").eq("id", meuProfessorId).maybeSingle();
      if(!pxRes.error && pxRes.data){ pixTipoPersonal = pxRes.data.pix_tipo||""; cidadePersonal = pxRes.data.cidade||""; }
    } catch(e){ pixTipoPersonal=""; cidadePersonal=""; }

    // Cobranças reais (tolerante: se a tabela/policy ainda não existir, não quebra o login).
    try {
      var baseCols = "id, valor, referencia, periodo_label, status, data_vencimento, data_pagamento, aula_ids";
      var pres = await sb.from("pagamentos").select(baseCols+", pago_informado_em").eq("aluno_id", meuAlunoId);
      if(pres.error){ // coluna pode não existir antes da migração 0014
        pres = await sb.from("pagamentos").select(baseCols).eq("aluno_id", meuAlunoId);
      }
      minhasCobrancas = pres.error ? [] : (pres.data||[]).map(rowToPagamento);
    } catch(e){ minhasCobrancas = []; }
  }
  function rowToPagamento(r){
    return { id:r.id, valor:Number(r.valor||0),
      label:r.periodo_label||r.referencia||"Cobrança",
      status:r.status||"pendente",
      vencimento:r.data_vencimento||null,
      pagamento:r.data_pagamento||null,
      pagoInformado: !!r.pago_informado_em,
      referencia:r.referencia||null,
      aulaIds: r.aula_ids||[] };
  }
  // Status efetivo de uma cobrança: pago / vencido / pendente.
  function statusCobranca(c){
    if(c.status==="pago") return "pago";
    if(c.vencimento && c.vencimento < HOJE_STR) return "vencido";
    return "pendente";
  }
  function rowToSolic(r){
    return { id:r.id, aulaId:r.aula_id, tipo:r.tipo,
      dataSugerida:r.data_sugerida, horaSugerida:(r.hora_sugerida||"").slice(0,5),
      contraData:r.contra_data, contraHora:(r.contra_hora||"").slice(0,5),
      status:r.status, createdAt:r.created_at, resposta:r.resposta||"" };
  }

  window.sairDaConta = function(){ sb.auth.signOut().then(function(){ location.reload(); }); };

  // rede de segurança
  setTimeout(function(){
    if(authEventJaProcessado) return;
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(err){
      console.error(err);
      if(!authEventJaProcessado){ authEventJaProcessado=true; mostrarGateAuth(); setErro("login-erro","Falha ao conectar no servidor. Tente recarregar a página."); }
    });
  }, 2000);

  /* =========================================================================
     Derivações a partir das aulas REAIS
     ========================================================================= */
  function aulaPassou(a){ return new Date(a.data+"T"+(a.hora||"00:00")+":00").getTime() <= Date.now(); }
  function ativa(a){ return a.status!=="cancelada" && a.status!=="remarcada"; }
  function ehProxima(a){ return (a.status==="agendada"||a.status==="confirmada") && !aulaPassou(a); }
  function ordAsc(x,y){ return (x.data+x.hora) < (y.data+y.hora) ? -1 : 1; }
  function ordDesc(x,y){ return (x.data+x.hora) > (y.data+y.hora) ? -1 : 1; }

  function proximasAulas(){ return aulas.filter(ehProxima).sort(ordAsc); }
  function labelStatusAula(st){
    if(st==="concluida") return "Concluída";
    if(st==="cancelada") return "Cancelada";
    if(st==="confirmada") return "Confirmada";
    return "Agendada";
  }
  // Enriquecimento visual do treino (por aluno): tipo/local vêm do cadastro.
  function labelTipo(t){
    if(t==="forca") return "Treino de Força";
    if(t==="funcional") return "Treino Funcional";
    if(t==="cardio") return "Treino de Cardio";
    return "Treino";
  }
  function enriquecer(a){
    return { id:a.id, data:a.data, hora:a.hora, status:a.status,
      titulo:labelTipo(meuTreinoTipo), sub:"Com "+nomePersonal, local:meuTreinoLocal, tipo:meuTreinoTipo,
      statusLabel:labelStatusAula(a.status), checkinEm:a.checkinEm, checkinOrigem:a.checkinOrigem };
  }
  function horaCheckin(iso){
    try{ return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}); }
    catch(e){ return ""; }
  }

  function segundaDaSemana(d){
    var x=new Date(d.getTime()); var dow=x.getDay(); var diff=(dow===0?-6:1-dow);
    x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x;
  }
  function derivarInicio(){
    var mes = HOJE_STR.slice(0,7);
    var noMes = aulas.filter(function(a){ return a.data.slice(0,7)===mes && ativa(a); });
    var realizadasMes = noMes.filter(function(a){ return a.status==="concluida"; }).length;
    var prox = proximasAulas();

    // semana (segunda a domingo)
    var seg = segundaDaSemana(HOJE); var dias=[]; var letras=["S","T","Q","Q","S","S","D"];
    var semAulas=0, semReal=0;
    for(var i=0;i<7;i++){
      var d=new Date(seg.getTime()); d.setDate(seg.getDate()+i); var ds=dataLocalStr(d);
      var daquele=aulas.filter(function(a){ return a.data===ds && ativa(a); });
      if(daquele.length){ semAulas++; if(daquele.some(function(a){return a.status==="concluida";})) semReal++; }
      dias.push({ l:letras[i], n:doisDig(d.getDate()), sel:ds===HOJE_STR, dot:daquele.length>0 });
    }

    // últimas atividades: a partir das aulas concluídas (real); fallback mock
    var atividades = aulas.filter(function(a){return a.status==="concluida";}).sort(ordDesc).slice(0,3).map(function(a){
      return { ic:"running", cor:"teal", titulo:"Treino realizado", sub:capitalizar(diaSemanaLabel(a.data))+", "+a.hora, quando:fmtDataBR(a.data).slice(0,5) };
    });

    return {
      proxima: prox[0] ? enriquecer(prox[0]) : null,
      aulasMes:{ v:realizadasMes, t:noMes.length },
      proximas: prox.length,
      semana:{ qtd:semAulas, realizadas:semReal, total:(semAulas||1), dias:dias,
               periodo: doisDig(seg.getDate())+"/"+doisDig(seg.getMonth()+1)+" - "+(function(){var f=new Date(seg.getTime());f.setDate(seg.getDate()+6);return doisDig(f.getDate())+"/"+doisDig(f.getMonth()+1);})() },
      solicitacoes: minhasSolicitacoes.filter(function(s){return s.status==="em_analise";}).length,
      atividades: atividades,
      progresso: MOCK.progresso
    };
  }

  /* =========================================================================
     ÍCONES / NAV / tipos de treino
     ========================================================================= */
  var IC = {
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8v10h-6v-7h-6v7H3z"/></svg>',
    aulas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    agenda:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>',
    mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
    financeiro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    chevL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    dumbbell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11M4 9l5-5M2 7l5-5M15 20l5-5M17 22l5-5"/></svg>',
    running:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="5" r="2"/><path d="M14 8l-3 3 2 3 1 5M11 11l-4 1-2 4M13 14l4 1 2 3"/></svg>',
    heart:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.9 2 5.5 5.2 5.1 7 4.9 8.6 5.9 12 9c3.4-3.1 5-4.1 6.8-3.9C22 5.5 23.4 8.9 22 11.7 19.5 16.4 12 21 12 21z"/></svg>',
    trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3M9 15h6M8 20h8M10 15l-.5 5M14 15l.5 5"/></svg>',
    box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
    arrowDown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    pix:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l3.2 3.2a2 2 0 0 0 1.4.6H18L21.5 9.8a2 2 0 0 1 0 2.8L18 16.1h-1.4a2 2 0 0 0-1.4.6L12 20.9l-3.2-3.2a2 2 0 0 0-1.4-.6H6L2.5 13.6a2 2 0 0 1 0-2.8L6 7.3h1.4a2 2 0 0 0 1.4-.6L12 2.5z"/></svg>',
    whats:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 0 1 0 16 8 8 0 0 1-4-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0 1 12 4zm-3.3 4c-.2 0-.5 0-.7.4-.2.4-.9.9-.9 2.2s.9 2.5 1 2.7c.2.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.6.8c-.1.2-.3.2-.5.1-.7-.3-1.4-.5-2.2-1.5-.3-.4 0-.3.4-1.1.1-.1 0-.3 0-.4l-.9-2.1c-.2-.6-.4-.5-.6-.5h-.6z"/></svg>',
    logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>'
  };
  var NAV = [
    {id:"inicio",label:"Início",ic:"home"},{id:"aulas",label:"Aulas",ic:"aulas"},
    {id:"agenda",label:"Agenda",ic:"agenda"},{id:"solicitacoes",label:"Solicitações",ic:"mail"},
    {id:"financeiro",label:"Financeiro",ic:"financeiro"}
  ];
  var TIPO = { forca:{ic:"dumbbell",tile:"tile-graf"}, funcional:{ic:"running",tile:"tile-azul"}, cardio:{ic:"heart",tile:"tile-vermelho"} };

  /* =========================================================================
     Shell (sidebar, bottom nav, header mobile)
     ========================================================================= */
  /* ---------------- Notificações (sino) ---------------------------------- */
  function listaNotificacoes(){
    var ns=[];
    var venc = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="vencido"; });
    if(venc.length){ ns.push({ ic:"box", cor:"red", titulo: venc.length+" cobrança"+(venc.length>1?"s":"")+" vencida"+(venc.length>1?"s":""), sub:"Toque para ver no Financeiro.", tab:"financeiro" }); }
    var contra = minhasSolicitacoes.filter(function(s){ return s.status==="contraproposta"; });
    if(contra.length){ ns.push({ ic:"agenda", cor:"amber", titulo:"Seu personal sugeriu um novo horário", sub:"Responda em Solicitações.", tab:"solicitacoes" }); }
    return ns;
  }
  function aplicarSino(btn){
    if(!btn) return;
    btn.innerHTML = IC.bell;
    if(listaNotificacoes().length) btn.classList.add("has-dot"); else btn.classList.remove("has-dot");
    btn.onclick = window.abrirNotificacoes;
  }
  window.abrirNotificacoes = function(){
    var ns = listaNotificacoes();
    var corpo = ns.length
      ? ns.map(function(x){ return '<button class="notif-row" onclick="irDeNotif(\''+x.tab+'\')"><span class="notif-ic '+x.cor+'">'+IC[x.ic]+'</span><div class="notif-txt"><div class="notif-t">'+x.titulo+'</div><div class="notif-s">'+x.sub+'</div></div><span class="chev">'+IC.chevR+'</span></button>'; }).join("")
      : '<div class="notif-vazio"><span class="notif-vazio-ic">'+IC.check+'</span>Tudo em dia! Sem novidades por aqui.</div>';
    abrirModal('<div class="notif-modal"><div class="modal-tit">Notificações</div><div class="notif-lista">'+corpo+'</div><div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div></div>');
  };
  window.irDeNotif = function(tab){ document.getElementById("modal-overlay").hidden=true; ir(tab); };

  function renderShell(){
    aplicarSino(document.getElementById("btn-bell"));
    var _ta=document.getElementById("topbar-avatar"); if(_ta) _ta.innerHTML=avatarInner();
    var _sl=document.querySelector(".sidebar-logo");
    if(_sl) _sl.innerHTML = brandLogo("") + '<div class="brand-sub">PORTAL DO ALUNO</div>';
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){
      return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>';
    }).join("");
    document.getElementById("sidebar-foot").innerHTML =
      '<button class="perfil-link" onclick="ir(\'perfil\')"><span class="avatar avatar-foto">'+avatarInner()+'</span>'+
        '<span class="perfil-link-txt"><b>'+meuNome+'</b><span>Ver perfil '+IC.chevR+'</span></span></button>'+
      '<div class="personal-box"><div class="personal-cap">Seu personal</div>'+
        '<div class="personal-row">'+logoPersonalBox()+
        '<span class="personal-txt"><b>'+nomePersonal+'</b><span>Personal Trainer</span></span></div></div>';
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){
      return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>';
    }).join("");
    renderMHeader();
  }
  function renderMHeader(){
    var el=document.getElementById("m-header");
    if(tabAtual==="inicio"){
      el.className="m-header m-header-inicio";
      el.innerHTML=brandLogo("logo-img-m")+
        '<div class="m-header-right"><button class="icon-btn'+(listaNotificacoes().length?' has-dot':'')+'" onclick="abrirNotificacoes()">'+IC.bell+'</button>'+
        '<div class="avatar avatar-sm" onclick="ir(\'perfil\')">'+avatarInner()+'</div></div>';
    } else {
      el.className="m-header m-header-titulo";
      var lbl = tabAtual==="perfil" ? "Meu perfil" : (NAV.filter(function(n){return n.id===tabAtual;})[0]||{label:""}).label;
      el.innerHTML='<h1 class="m-title">'+lbl+'</h1>';
    }
  }

  /* ---------------- componentes ------------------------------------------- */
  function statusBadge(st){
    var cls="ok";
    if(st==="Em análise"||st==="Pendente") cls="warn";
    else if(st==="Negada"||st==="Cancelada") cls="dang";
    return '<span class="badge badge-'+cls+'">'+st+'</span>';
  }
  function tileTreino(tipo){ var t=TIPO[tipo]||TIPO.forca; return '<span class="treino-tile '+t.tile+'">'+IC[t.ic]+'</span>'; }
  function cardAula(a, comLocal){
    var selo = (a.checkinOrigem==="checkout")
      ? '<div class="aula-item-checkout">'+IC.check+' Concluída via check-out'+(a.checkinEm?' · '+horaCheckin(a.checkinEm):'')+'</div>'
      : '';
    return '<div class="aula-item">'+tileTreino(a.tipo)+
      '<div class="aula-item-info"><div class="aula-item-hora">'+a.hora+'</div>'+
      '<div class="aula-item-tit">'+a.titulo+'</div><div class="aula-item-sub">'+a.sub+'</div>'+
      (comLocal&&a.local?'<div class="aula-item-local">'+IC.pin+a.local+'</div>':'')+selo+'</div>'+
      '<div class="aula-item-dir">'+statusBadge(a.statusLabel)+'<span class="chev">'+IC.chevR+'</span></div></div>';
  }

  /* =========================================================================
     TELA: Início
     ========================================================================= */
  function screenInicio(){
    var D=derivarInicio();
    var proxima = D.proxima
      ? '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span>'+statusBadge(D.proxima.statusLabel)+'</div>'+
          '<div class="prox-main">'+tileTreino(D.proxima.tipo)+
            '<div class="prox-info"><div class="prox-dh"><span class="dh-long">'+capitalizar(diaSemanaLabel(D.proxima.data))+', '+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span>'+
              '<span class="dh-short">'+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span></div>'+
              '<div class="prox-tit">'+D.proxima.titulo+'</div><div class="prox-sub">'+D.proxima.sub+'</div>'+
              (D.proxima.local?'<div class="prox-local">'+IC.pin+D.proxima.local+'</div>':'')+'</div>'+
            '<span class="chev chev-lg">'+IC.chevR+'</span></div>'+
          '<div class="prox-acoes"><button class="btn btn-primary" onclick="ir(\'agenda\')">Ver detalhes</button>'+
            '<button class="btn btn-dark" onclick="solicitarRemarcacao(\''+D.proxima.id+'\')">Remarcar</button>'+
            '<button class="btn btn-dang" onclick="solicitarCancelamento(\''+D.proxima.id+'\')">Cancelar</button></div></div>'
      : '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span></div>'+
          '<div class="lista-vazia" style="padding:14px 2px">Você não tem aulas agendadas no momento.</div></div>';

    var s=D.semana; var pct = s.total? Math.round(s.realizadas/s.total*100):0;
    var semana='<div class="card semana-card"><div class="semana-top">'+
      '<div><div class="semana-cap">Sua semana</div><div class="semana-n">'+s.qtd+' aulas</div><div class="semana-per">'+s.periodo+'</div></div>'+
      '<div class="ring" style="--pct:'+pct+'"><div class="ring-in"><b>'+s.realizadas+'/'+s.total+'</b><span>aulas realizadas</span></div></div></div>'+
      '<div class="semana-dias">'+s.dias.map(function(d){ return '<div class="sd"><span class="sd-l">'+d.l+'</span><span class="sd-n'+(d.sel?' sel':'')+'">'+d.n+'</span><span class="sd-dot'+(d.dot?' on':'')+'"></span></div>'; }).join("")+'</div></div>';

    function statCard(cls,ic,cap,val,extra){ return '<div class="card stat-card"><span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="stat-txt"><span class="stat-cap">'+cap+'</span><span class="stat-val">'+val+'</span>'+(extra||"")+'</div></div>'; }
    var barra = D.aulasMes.t ? Math.round(D.aulasMes.v/D.aulasMes.t*100) : 0;
    var stats='<div class="stat-row">'+
      statCard("si-teal","agenda","Aulas do mês",D.aulasMes.v+'<span class="stat-sm">/'+D.aulasMes.t+'</span>','<div class="stat-bar"><span style="width:'+barra+'%"></span></div>')+
      statCard("si-azul","running","Próximas aulas",String(D.proximas),'<span class="stat-foot">agendadas</span>')+
      statCard("si-verde","box",'<span>Financeiro</span>','<span class="verde">Em dia</span> <span class="mini-check">'+IC.check+'</span>',"")+
      statCard("si-amber","trophy","Solicitações",String(D.solicitacoes),'<span class="stat-foot">em análise <span class="mini-clock">'+IC.clock+'</span></span>')+
      '</div>';

    var atividades='<div class="card lista-card"><div class="card-head"><h3>Últimas atividades</h3><button class="link" onclick="toast(\'Em breve\')">Ver todas</button></div>'+
      (D.atividades.length ? D.atividades.map(function(a){ return '<div class="ativ-row"><span class="ativ-ic '+a.cor+'">'+IC[a.ic]+'</span><div class="ativ-info"><div class="ativ-tit">'+a.titulo+'</div><div class="ativ-sub">'+a.sub+'</div></div><div class="ativ-dir"><span>'+a.quando+'</span>'+IC.chevR+'</div></div>'; }).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Sem atividades recentes.</div>')+'</div>';

    var pr=D.progresso;
    var progresso='<div class="card lista-card"><div class="card-head"><h3>Meu progresso</h3><button class="link" onclick="toast(\'Em breve\')">Ver evolução</button></div>'+
      '<div class="prog-grid"><div class="prog-col"><div class="prog-cap">Peso atual '+IC.chevR+'</div><div class="prog-val">'+pr.peso+(pr.peso!=="—"?' <span>kg</span>':'')+'</div>'+
        '<div class="prog-foot">registre no app (em breve)</div></div>'+
      '<div class="prog-col"><div class="prog-cap">Aulas realizadas '+IC.chevR+'</div><div class="prog-val">'+(aulas.filter(function(a){return a.status==="concluida";}).length)+'</div><div class="prog-foot">no total</div></div></div></div>';

    var heroBtn = meuCheckinToken
      ? '<button class="btn btn-checkin" onclick="abrirCheckin()">'+IC.box+' Meu check-out</button>'
      : '';
    return '<div class="hero"><div class="hero-txt"><h1>Olá, '+(meuNome.split(" ")[0]||"aluno")+'!</h1><p>Vamos em busca de mais resultados! 💪</p></div>'+heroBtn+'</div>'+
      '<div class="grid-prox">'+proxima+semana+'</div>'+stats+'<div class="grid-2">'+atividades+progresso+'</div>';
  }
  window.abrirCheckin = async function(){
    if(!meuCheckinToken){ toast("Check-in indisponível. Atualize o app ou fale com seu personal."); return; }
    var svg;
    try{
      svg = await QRCode.toString("LT360CHECKIN:"+meuCheckinToken, { type:"svg", margin:1, errorCorrectionLevel:"M" });
    }catch(e){ console.error(e); toast("Não foi possível gerar o QR."); return; }
    var html='<div class="checkin-modal">'+
      '<div class="modal-tit">Meu check-out</div>'+
      '<div class="modal-sub">Mostre este QR ao seu personal para finalizar a aula de hoje.</div>'+
      '<div class="qr-panel">'+svg+'</div>'+
      '<div class="qr-nome">'+meuNome+'</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div>'+
      '</div>';
    abrirModal(html);
  };

  /* =========================================================================
     TELA: Aulas (próximas / realizadas / canceladas) — real
     ========================================================================= */
  function listaAulasPorTab(){
    var arr;
    if(aulasTab==="realizadas") arr=aulas.filter(function(a){ return a.status==="concluida"; }).sort(ordDesc);
    else if(aulasTab==="canceladas") arr=aulas.filter(function(a){ return a.status==="cancelada"; }).sort(ordDesc);
    else arr=proximasAulas();
    return arr.map(enriquecer);
  }
  window.setAulasTab = function(t){ aulasTab=t; ir("aulas"); };
  function screenAulas(){
    var lista=listaAulasPorTab();
    var tabs='<div class="seg">'+
      '<button class="seg-b'+(aulasTab==="proximas"?" active":"")+'" onclick="setAulasTab(\'proximas\')">Próximas</button>'+
      '<button class="seg-b'+(aulasTab==="realizadas"?" active":"")+'" onclick="setAulasTab(\'realizadas\')">Realizadas</button>'+
      '<button class="seg-b'+(aulasTab==="canceladas"?" active":"")+'" onclick="setAulasTab(\'canceladas\')">Canceladas</button></div>';
    // agrupa por dia
    var porDia={}, ordem=[];
    lista.forEach(function(a){ if(!porDia[a.data]){ porDia[a.data]=[]; ordem.push(a.data); } porDia[a.data].push(a); });
    var corpo = ordem.length ? ordem.map(function(ds){
      return '<div class="aulas-grupo"><div class="grupo-dia">'+capitalizar(diaSemanaLabel(ds))+', '+fmtDataBR(ds)+'</div>'+porDia[ds].map(function(a){return cardAula(a,false);}).join("")+'</div>';
    }).join("") : '<div class="lista-vazia">Nenhuma aula nesta lista.</div>';
    return '<div class="only-desktop pg-head"><h1>Aulas</h1></div>'+tabs+corpo;
  }

  /* =========================================================================
     TELA: Agenda — calendário do mês atual + detalhe do dia (real)
     ========================================================================= */
  function diasComAula(mesPrefix){
    var set={}; aulas.forEach(function(a){ if(a.data.slice(0,7)===mesPrefix && ativa(a)) set[parseInt(a.data.slice(8),10)]=true; }); return set;
  }
  window.selecionarDiaAgenda = function(ds){ agendaSel=ds; ir("agenda"); };
  window.setAgendaView = function(v){ agendaView=v; ir("agenda"); };
  window.agendaNav = function(dir){
    if(agendaView==="semana"){ agendaSel = addDias(agendaSel, dir*7); }
    else { var d=new Date(agendaAno, agendaMes+dir, 1); agendaAno=d.getFullYear(); agendaMes=d.getMonth(); }
    ir("agenda");
  };
  function addDias(ds, n){ var p=ds.split("-"); var d=new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()+n); return dataLocalStr(d); }
  function aulasDoDia(ds){ return aulas.filter(function(a){ return a.data===ds && ativa(a); }).sort(ordAsc).map(enriquecer); }
  function blocoDetalheDia(ds){
    var doDia = aulasDoDia(ds);
    return '<div class="agenda-det-dia">'+capitalizar(diaSemanaLabel(ds))+', '+fmtDataBR(ds)+'</div>'+
      (doDia.length ? doDia.map(function(it){ return '<div class="agenda-det-item"><div class="agenda-det-hora"><span class="dot-teal"></span>'+it.hora+'</div>'+cardAula(it,true)+'</div>'; }).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Nenhuma aula neste dia.</div>');
  }
  function calLabel(){
    if(agendaView==="semana"){
      var ini=addDias(agendaSel, -(new Date(agendaSel.split("-")[0],agendaSel.split("-")[1]-1,agendaSel.split("-")[2]).getDay()));
      var fim=addDias(ini,6);
      return fmtDataBR(ini).slice(0,5)+" – "+fmtDataBR(fim).slice(0,5);
    }
    return capitalizar(MESES[agendaMes])+' de '+agendaAno;
  }
  function screenAgenda(){
    var nav='<div class="cal-nav"><button class="cal-arrow" onclick="agendaNav(-1)">'+IC.chevL+'</button>'+
      '<span class="cal-mes">'+calLabel()+'</span>'+
      '<button class="cal-arrow" onclick="agendaNav(1)">'+IC.chevR+'</button></div>';

    var corpo;
    if(agendaView==="lista"){
      var mesPrefixL = agendaAno+"-"+doisDig(agendaMes+1);
      var doMes = aulas.filter(function(a){ return a.data.slice(0,7)===mesPrefixL && ativa(a); }).sort(ordAsc).map(enriquecer);
      var porDia={}, ordem=[];
      doMes.forEach(function(a){ if(!porDia[a.data]){ porDia[a.data]=[]; ordem.push(a.data); } porDia[a.data].push(a); });
      corpo = ordem.length ? ordem.map(function(ds){
        return '<div class="aulas-grupo"><div class="grupo-dia">'+capitalizar(diaSemanaLabel(ds))+', '+fmtDataBR(ds)+'</div>'+porDia[ds].map(function(a){return cardAula(a,true);}).join("")+'</div>';
      }).join("") : '<div class="lista-vazia">Nenhuma aula neste mês.</div>';
      corpo = '<div class="card agenda-det">'+nav+corpo+'</div>';
    } else if(agendaView==="semana"){
      var p=agendaSel.split("-"); var inicioSemana=addDias(agendaSel, -(new Date(+p[0],+p[1]-1,+p[2]).getDay()));
      var dias=[]; for(var k=0;k<7;k++) dias.push(addDias(inicioSemana,k));
      var blocos=dias.map(function(ds){
        var aa=aulasDoDia(ds);
        return '<div class="sem-dia'+(ds===HOJE_STR?' hoje':'')+'"><div class="grupo-dia">'+capitalizar(diaSemanaLabel(ds)).slice(0,3)+', '+fmtDataBR(ds).slice(0,5)+'</div>'+
          (aa.length ? aa.map(function(a){return cardAula(a,true);}).join("") : '<div class="sem-vazio">—</div>')+'</div>';
      }).join("");
      corpo='<div class="card agenda-det">'+nav+blocos+'</div>';
    } else {
      // Mês (calendário + detalhe do dia)
      var mesPrefix = agendaAno+"-"+doisDig(agendaMes+1);
      var primeiro = new Date(agendaAno,agendaMes,1).getDay();
      var diasNoMes = new Date(agendaAno,agendaMes+1,0).getDate();
      var dots=diasComAula(mesPrefix);
      var cells=[]; for(var i=0;i<primeiro;i++) cells.push(null); for(var d=1;d<=diasNoMes;d++) cells.push(d);
      while(cells.length%7) cells.push(null);
      var wk=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
      var cal=nav+'<div class="cal-head">'+wk.map(function(w){return '<span>'+w+'</span>';}).join("")+'</div>'+
        '<div class="cal-grid">'+cells.map(function(d){
          if(d===null) return '<span class="cal-cell empty"></span>';
          var ds=mesPrefix+"-"+doisDig(d); var sel=ds===agendaSel; var dot=dots[d];
          return '<span class="cal-cell'+(sel?' sel':'')+'" onclick="selecionarDiaAgenda(\''+ds+'\')"><span class="cal-n">'+d+'</span>'+(dot?'<span class="cal-dot teal"></span>':'')+'</span>';
        }).join("")+'</div>';
      corpo='<div class="agenda-cal card">'+cal+'</div><div class="agenda-lado-det card agenda-det">'+blocoDetalheDia(agendaSel)+'</div>';
    }

    function segAg(id,rot){ return '<button class="seg-b'+(agendaView===id?" active":"")+'" onclick="setAgendaView(\''+id+'\')">'+rot+'</button>'; }
    var seg='<div class="seg seg-agenda">'+segAg("mes","Mês")+segAg("semana","Semana")+segAg("lista","Lista")+'</div>';

    var wrapCls = agendaView==="mes" ? "agenda-wrap" : "agenda-wrap ag-full";
    return '<div class="only-desktop pg-head"><h1>Agenda</h1><p class="pg-sub">Visualize todas as suas aulas e compromissos.</p></div>'+
      seg+'<div class="'+wrapCls+'">'+corpo+'</div>';
  }

  /* =========================================================================
     TELA: Solicitações (mock — Fase 3)
     ========================================================================= */
  function labelStatusSolic(st){
    if(st==="aprovada")return"Aprovada"; if(st==="negada")return"Negada";
    if(st==="contraproposta")return"Horário sugerido"; return"Em análise";
  }
  function badgeSolic(st){
    var cls="warn";
    if(st==="aprovada")cls="ok"; else if(st==="negada")cls="dang"; else if(st==="contraproposta")cls="info";
    return '<span class="badge badge-'+cls+'">'+labelStatusSolic(st)+'</span>';
  }
  function visualSolic(s){ return s.tipo==="remarcar" ? {titulo:"Remarcação de aula",ic:"agenda",cor:"red"} : {titulo:"Cancelamento de aula",ic:"check",cor:"green"}; }
  function quandoSolic(s){
    if(s.tipo==="remarcar" && s.dataSugerida){ return "Pedido: "+capitalizar(diaSemanaLabel(s.dataSugerida)).slice(0,3)+", "+fmtDataBR(s.dataSugerida).slice(0,5)+(s.horaSugerida?" • "+s.horaSugerida:""); }
    var a=getAula(s.aulaId);
    if(a) return capitalizar(diaSemanaLabel(a.data)).slice(0,3)+", "+fmtDataBR(a.data).slice(0,5)+" • "+a.hora;
    return "";
  }
  function waLink(tel, msg){ var d=(tel||"").replace(/\D/g,""); if(d.length<=11) d="55"+d; return "https://wa.me/"+d+"?text="+encodeURIComponent(msg); }
  function waPersonalBtn(){
    if(!telefonePersonal) return "";
    var msg="Olá "+((nomePersonal||"").split(" ")[0])+"! Sobre minha solicitação no portal LT360...";
    return '<a class="btn btn-wa" href="'+waLink(telefonePersonal,msg)+'" target="_blank" rel="noopener">'+IC.whats+' WhatsApp</a>';
  }
  function cardSolicitacao(s){
    var v=visualSolic(s);
    var topo='<div class="solic-card">'+
      '<span class="solic-ic '+v.cor+'">'+IC[v.ic]+'</span>'+
      '<div class="solic-info"><div class="solic-tit">'+v.titulo+'</div><div class="solic-quando">'+quandoSolic(s)+'</div>'+
      '<div class="solic-sol">Solicitado em '+fmtDataBR((s.createdAt||HOJE_STR).slice(0,10))+'</div></div>'+
      '<div class="solic-dir">'+badgeSolic(s.status)+'<span class="chev">'+IC.chevR+'</span></div></div>';
    var extra="";
    if(s.status==="contraproposta"){
      extra='<div class="solic-contra">'+
        '<div class="solic-contra-txt">Seu personal sugeriu: <b>'+capitalizar(diaSemanaLabel(s.contraData)).slice(0,3)+', '+fmtDataBR(s.contraData).slice(0,5)+' • '+s.contraHora+'</b></div>'+
        '<div class="solic-contra-botoes">'+ waPersonalBtn() +
          '<button class="btn btn-dark" onclick="responderContra(\''+s.id+'\',false)">Recusar</button>'+
          '<button class="btn btn-primary" onclick="responderContra(\''+s.id+'\',true)">Aceitar</button>'+
        '</div></div>';
    } else if(s.status==="em_analise" && telefonePersonal){
      extra='<div class="solic-contra"><div class="solic-contra-botoes">'+waPersonalBtn()+'</div></div>';
    }
    return '<div class="solic-wrap">'+topo+extra+'</div>';
  }
  window.setSolicTab = function(t){ solicTab=t; ir("solicitacoes"); };
  function solicNaTab(s){
    if(solicTab==="todas") return true;
    if(solicTab==="em_analise") return s.status==="em_analise" || s.status==="contraproposta";
    return s.status===solicTab; // aprovada | negada
  }
  function segSolic(id,rot){ return '<button class="seg-b'+(solicTab===id?" active":"")+'" onclick="setSolicTab(\''+id+'\')">'+rot+'</button>'; }
  function screenSolic(){
    var tabs='<div class="seg seg-wrap">'+segSolic("todas","Todas")+segSolic("em_analise","Em análise")+
      segSolic("aprovada","Aprovadas")+segSolic("negada","Negadas")+'</div>';
    var nova='<button class="btn btn-primary btn-nova" onclick="toast(\'Para pedir remarcação ou cancelamento, use os botões na aba Aulas.\')">'+IC.plus+' Nova solicitação</button>';
    var ordenadas = minhasSolicitacoes.slice()
      .filter(solicNaTab)
      .sort(function(x,y){ return (y.createdAt||"")<(x.createdAt||"")?-1:1; });
    var vazio = solicTab==="todas" ? "Você ainda não fez nenhuma solicitação." : "Nenhuma solicitação nesta categoria.";
    var lista = ordenadas.length ? ordenadas.map(cardSolicitacao).join("")
      : '<div class="lista-vazia">'+vazio+'</div>';
    return '<div class="only-desktop pg-head"><h1>Solicitações</h1></div>'+tabs+nova+lista;
  }
  window.responderContra = async function(id, aceitar){
    var r = await sb.rpc("responder_contraproposta", { p_solic_id:id, p_aceitar: aceitar });
    if(r.error){ console.error(r.error); toast("Não foi possível: "+(r.error.message||"erro")); return; }
    await recarregarAposResposta();
    toast(aceitar ? "Horário confirmado! Aula remarcada." : "Sugestão recusada.");
    ir("solicitacoes");
  };
  async function recarregarAposResposta(){
    try{
      var au = await sb.from("aulas").select("id, data, hora, status, checkin_em, checkin_origem").eq("aluno_id", meuAlunoId);
      if(!au.error) aulas = (au.data||[]).map(function(r){ return {id:r.id,data:r.data,hora:(r.hora||"").slice(0,5),status:r.status,checkinEm:r.checkin_em||null,checkinOrigem:r.checkin_origem||null}; });
      var sr = await sb.from("solicitacoes").select("id, aula_id, tipo, data_sugerida, hora_sugerida, contra_data, contra_hora, status, created_at, resposta").eq("aluno_id", meuAlunoId);
      if(!sr.error) minhasSolicitacoes = (sr.data||[]).map(rowToSolic);
    }catch(e){ console.error(e); }
  }
  function dispHint(){
    if(!dispPersonal.length) return "";
    var ABREV=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"], byDay={};
    dispPersonal.forEach(function(d){ (byDay[d.dia]=byDay[d.dia]||[]).push(d.ini+"–"+d.fim); });
    var parts=[]; for(var i=0;i<7;i++){ if(byDay[i]) parts.push(ABREV[i]+" "+byDay[i].join(", ")); }
    return parts.length ? '<div class="modal-hint">Seu personal atende: '+parts.join(" · ")+'</div>' : "";
  }

  function getAula(id){ for(var i=0;i<aulas.length;i++) if(aulas[i].id===id) return aulas[i]; return null; }
  function addDias(ds,n){ var d=new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return dataLocalStr(d); }

  // ---- Modal de solicitação (remarcar / cancelar) ----
  window.fecharModalSolic = function(ev){ if(ev && ev.target && ev.target.id!=="modal-overlay" && ev.type==="click") return; document.getElementById("modal-overlay").hidden=true; };
  function abrirModal(html){ document.getElementById("modal-conteudo").innerHTML=html; document.getElementById("modal-overlay").hidden=false; }

  window.solicitarRemarcacao = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir remarcação</div>'+
      '<div class="modal-sub">Aula atual: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      dispHint()+
      '<div class="field"><label for="solic-data">Nova data</label><input id="solic-data" type="date" value="'+addDias(a.data,1)+'"></div>'+
      '<div class="field"><label for="solic-hora">Novo horário</label><input id="solic-hora" type="time" value="'+a.hora+'"></div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Ex.: tenho um compromisso nesse horário"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-primary" id="solic-enviar" onclick="enviarSolicitacao(\'remarcar\',\''+id+'\')">Enviar pedido</button></div>');
  };
  window.solicitarCancelamento = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir cancelamento</div>'+
      '<div class="modal-sub">Aula: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Conte o motivo, se quiser"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-dang" id="solic-enviar" onclick="enviarSolicitacao(\'cancelar\',\''+id+'\')">Enviar pedido</button></div>');
  };

  window.enviarSolicitacao = async function(tipo, aulaId){
    var msgEl=document.getElementById("solic-msg");
    var payload={ aluno_id:meuAlunoId, professor_id:meuProfessorId, aula_id:aulaId, tipo:tipo, mensagem:(msgEl&&msgEl.value.trim())||null };
    if(tipo==="remarcar"){
      var d=document.getElementById("solic-data").value, h=document.getElementById("solic-hora").value;
      if(!d||!h){ toast("Informe a nova data e o horário."); return; }
      payload.data_sugerida=d; payload.hora_sugerida=h;
    }
    var btn=document.getElementById("solic-enviar"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
    var r=await sb.from("solicitacoes").insert(payload).select().maybeSingle();
    if(r.error){ console.error(r.error); toast("Não foi possível enviar: "+(r.error.message||"erro")); if(btn){btn.disabled=false;btn.textContent="Enviar pedido";} return; }
    if(r.data) minhasSolicitacoes.unshift(rowToSolic(r.data));
    document.getElementById("modal-overlay").hidden=true;
    toast("Solicitação enviada ao personal.");
    ir("solicitacoes");
  };

  /* =========================================================================
     TELA: Financeiro (cobranças REAIS; PIX real)
     ========================================================================= */
  function badgeCobranca(st){
    if(st==="pago")    return '<span class="badge badge-ok">Pago</span>';
    if(st==="vencido") return '<span class="badge badge-dang">Vencido</span>';
    return '<span class="badge badge-warn">Pendente</span>';
  }
  function detalheCobranca(c, st){
    if(st==="pago")    return (c.pagamento?("Pago em "+fmtDataBR(c.pagamento)):"Pago");
    if(st==="vencido") return (c.vencimento?("Venceu em "+fmtDataBR(c.vencimento)):"Em atraso");
    return (c.vencimento?("Vence em "+fmtDataBR(c.vencimento)):"Em aberto");
  }
  window.setFinTab = function(t){ finTab=t; ir("financeiro"); };
  /* ---- Pix copia-e-cola (BR Code EMV) ---------------------------------- */
  function soDigitos(s){ return (s||"").replace(/\D/g,""); }
  function semAcentoUpper(s){ return (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim(); }
  function crc16ccitt(str){
    var crc=0xFFFF;
    for(var i=0;i<str.length;i++){
      crc ^= (str.charCodeAt(i) & 0xFF) << 8;
      for(var j=0;j<8;j++){ crc = (crc & 0x8000) ? ((crc<<1) ^ 0x1021) : (crc<<1); crc &= 0xFFFF; }
    }
    return ("000"+crc.toString(16).toUpperCase()).slice(-4);
  }
  function tlv(id, val){ return id + ("0"+val.length).slice(-2) + val; }
  // Normaliza a chave conforme o tipo. Retorna null quando não dá para montar
  // com segurança (ex.: numérico sem tipo definido -> ambíguo CPF x telefone).
  function normalizarChavePix(chave, tipo){
    var c=(chave||"").trim(); tipo=(tipo||"").toLowerCase();
    if(!tipo){
      if(c.indexOf("@")>=0) tipo="email";
      else if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) tipo="aleatoria";
      else return null;
    }
    if(tipo==="email") return c.toLowerCase();
    if(tipo==="aleatoria") return c;
    if(tipo==="telefone"){ var d=soDigitos(c); if(d.indexOf("55")===0 && d.length>=12) return "+"+d; if(d.length>=10 && d.length<=11) return "+55"+d; return null; }
    if(tipo==="cpf"){ var cp=soDigitos(c); return cp.length===11?cp:null; }
    if(tipo==="cnpj"){ var cn=soDigitos(c); return cn.length===14?cn:null; }
    return null;
  }
  function montarPixCopiaECola(opts){
    var chave = normalizarChavePix(opts.chave, opts.tipo);
    if(!chave) return null;
    var nome = (semAcentoUpper(opts.nome).slice(0,25)) || "RECEBEDOR";
    var cidade = (semAcentoUpper(opts.cidade).slice(0,15)) || "BRASIL";
    var gui = tlv("26", tlv("00","br.gov.bcb.pix")+tlv("01",chave));
    var valor = (opts.valor!=null) ? Number(opts.valor).toFixed(2) : null;
    var payload = tlv("00","01")+gui+tlv("52","0000")+tlv("53","986")+
      (valor?tlv("54",valor):"")+tlv("58","BR")+tlv("59",nome)+tlv("60",cidade)+
      tlv("62", tlv("05","***"))+"6304";
    return payload + crc16ccitt(payload);
  }
  window.abrirPagamento = async function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var chave = pixPersonal || "(chave PIX não cadastrada)";
    var brcode = pixPersonal ? montarPixCopiaECola({ chave:pixPersonal, tipo:pixTipoPersonal, nome:nomePersonal, cidade:cidadePersonal, valor:c.valor }) : null;
    var blocoQR = "";
    if(brcode){
      var svg=""; try{ svg = await QRCode.toString(brcode, { type:"svg", margin:1, errorCorrectionLevel:"M" }); }catch(e){ svg=""; }
      blocoQR = (svg ? '<div class="pag-qr-cap">Escaneie no app do seu banco</div><div class="qr-panel pag-qr">'+svg+'</div>' : '')+
        '<div class="pag-pix-cap">Pix copia e cola</div>'+
        '<div class="pag-pix-row"><span class="pag-pix-key" id="pag-brcode">'+brcode+'</span>'+
        '<button class="btn btn-dark pag-copy" onclick="copiarTexto(\'pag-brcode\')">Copiar</button></div>';
    }
    var html='<div class="pag-modal">'+
      '<div class="modal-tit">Pagamento via Pix</div>'+
      '<div class="modal-sub">'+c.label+'</div>'+
      '<div class="pag-valor">'+fmtMoeda(c.valor)+'</div>'+
      blocoQR+
      '<div class="pag-pix"><div class="pag-pix-cap">'+(brcode?'Ou pague pela chave':'Chave Pix do seu personal')+'</div>'+
        '<div class="pag-pix-row"><span class="pag-pix-key" id="pag-pix-key">'+chave+'</span>'+
        '<button class="btn btn-dark pag-copy" onclick="copiarTexto(\'pag-pix-key\')">Copiar</button></div></div>'+
      '<div class="pag-hint">'+(brcode?'Escaneie o QR ou cole o código no app do seu banco (o valor já vai preenchido).':'Abra o app do seu banco, escolha <b>Pix por chave</b>, cole a chave e informe o valor acima.')+'</div>'+
      (c.pagoInformado
        ? '<div class="pag-informado">'+IC.check+' Você já avisou este pagamento. Aguarde a confirmação do seu personal.</div>'
        : '<button class="btn btn-primary block" onclick="informarPagamento(\''+c.id+'\')">'+IC.check+' Já fiz o pagamento</button>')+
      '<div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div></div>';
    abrirModal(html);
  };
  window.informarPagamento = async function(id){
    try{
      var r = await sb.rpc("informar_pagamento", { p_pagamento_id:id });
      if(r.error){ toast("Não foi possível avisar: "+(r.error.message||"erro")); return; }
      minhasCobrancas.forEach(function(x){ if(x.id===id) x.pagoInformado=true; });
      document.getElementById("modal-overlay").hidden=true;
      toast("Avisamos seu personal! Ele vai confirmar o recebimento.");
      if(tabAtual==="financeiro") ir("financeiro");
      aplicarSino(document.getElementById("btn-bell"));
    }catch(e){ console.error(e); toast("Falha ao avisar o pagamento."); }
  };
  function aulasDaCobranca(c){
    return (c.aulaIds && c.aulaIds.length)
      ? aulas.filter(function(a){ return c.aulaIds.indexOf(a.id)>-1; }).sort(function(a,b){ return a.data<b.data?-1:1; })
      : [];
  }
  window.abrirComprovante = function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var doReceibo = aulasDaCobranca(c);
    var valorUnit = (meuPlanoCobranca==="por_aula") ? meuValorAula : null;
    var itens;
    if(doReceibo.length){
      itens = doReceibo.map(function(a){
        return '<div class="comp-item"><span>'+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+' · '+fmtDataBR(a.data)+' · '+a.hora+'</span>'+
          (valorUnit!==null?'<b>'+fmtMoeda(valorUnit)+'</b>':'')+'</div>';
      }).join("");
    } else {
      itens = '<div class="comp-item"><span>'+(c.referencia||c.label)+'</span><b>'+fmtMoeda(c.valor)+'</b></div>';
    }
    var html='<div class="comprovante">'+
      '<div class="modal-tit">Comprovante</div>'+
      '<div class="comp-card"><div class="comp-top"><span class="comp-ok">'+IC.check+'</span>'+
        '<div><div class="comp-status">Pagamento confirmado</div><div class="comp-ref">'+c.label+'</div></div></div>'+
        '<div class="comp-linha"><span>Aluno</span><b>'+meuNome+'</b></div>'+
        '<div class="comp-linha"><span>Personal</span><b>'+nomePersonal+'</b></div>'+
        (c.pagamento?'<div class="comp-linha"><span>Pago em</span><b>'+fmtDataBR(c.pagamento)+'</b></div>':'')+
        '<div class="comp-itens-tit">Serviços prestados</div>'+
        '<div class="comp-itens'+(doReceibo.length>=4?' cols-2':'')+'">'+itens+'</div>'+
        '<div class="comp-total"><span>Total pago</span><b>'+fmtMoeda(c.valor)+'</b></div>'+
      '</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Fechar</button>'+
        '<button class="btn btn-primary" onclick="compartilharComprovante(\''+c.id+'\')">Compartilhar</button></div></div>';
    abrirModal(html);
  };
  window.compartilharComprovante = function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var linhas = aulasDaCobranca(c).map(function(a){ return "  • "+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+" "+fmtDataBR(a.data)+" "+a.hora; }).join("\n");
    var txt="Comprovante LT360\n"+c.label+"\nAluno: "+meuNome+"\nPersonal: "+nomePersonal+(c.pagamento?"\nPago em: "+fmtDataBR(c.pagamento):"")+(linhas?"\nServiços prestados:\n"+linhas:"")+"\nTotal pago: "+fmtMoeda(c.valor);
    if(navigator.share){ navigator.share({ title:"Comprovante LT360", text:txt }).catch(function(){}); }
    else { copiarTextoBruto(txt); }
  };
  function copiarTextoBruto(t){
    function ok(){ toast("Comprovante copiado!"); }
    try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok,function(){ok();}); } else { var ta=document.createElement("textarea"); ta.value=t; ta.style.position="absolute"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); ok(); } }catch(e){ toast("Copie manualmente."); }
  }
  window.copiarTexto = function(elId){
    var el=document.getElementById(elId); var txt=el?el.textContent:"";
    function ok(){ toast("Copiado!"); }
    function fallback(t){ try{ var ta=document.createElement("textarea"); ta.value=t; ta.setAttribute("readonly",""); ta.style.position="absolute"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); ok(); }catch(e){ toast("Não consegui copiar. Copie manualmente."); } }
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(ok, function(){ fallback(txt); }); } else fallback(txt); }
    catch(e){ fallback(txt); }
  };
  function screenFinanceiro(){
    var tabs='<div class="seg">'+
      '<button class="seg-b'+(finTab==="cobrancas"?" active":"")+'" onclick="setFinTab(\'cobrancas\')">Cobranças</button>'+
      '<button class="seg-b'+(finTab==="historico"?" active":"")+'" onclick="setFinTab(\'historico\')">Histórico</button></div>';

    // Situação: vencidas, próxima em aberto (futura mais próxima).
    var vencidas = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="vencido"; });
    var emAberto = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="pendente" && c.vencimento; })
                                  .sort(function(a,b){ return a.vencimento<b.vencimento?-1:1; });
    var banner;
    if(vencidas.length){
      banner='<div class="fin-banner fin-banner-alerta"><span class="fin-banner-ic">'+IC.bell+'</span><div>'+
        '<div class="fin-banner-t">Você tem '+vencidas.length+' cobrança'+(vencidas.length>1?'s':'')+' em atraso</div>'+
        '<div class="fin-banner-s">Regularize com seu personal pelo PIX abaixo</div></div></div>';
    } else if(emAberto.length){
      banner='<div class="fin-banner"><span class="fin-banner-ic">'+IC.check+'</span><div>'+
        '<div class="fin-banner-t">Sua mensalidade está em dia!</div>'+
        '<div class="fin-banner-s">Próximo vencimento em '+fmtDataBR(emAberto[0].vencimento)+'</div></div></div>';
    } else {
      banner='<div class="fin-banner"><span class="fin-banner-ic">'+IC.check+'</span><div>'+
        '<div class="fin-banner-t">Nenhuma cobrança em aberto</div>'+
        '<div class="fin-banner-s">Você não tem pagamentos pendentes no momento</div></div></div>';
    }

    // Cobranças = em aberto (pendente/vencido); Histórico = pagas.
    var ordenadas = minhasCobrancas.slice()
      .filter(function(c){
        var st=statusCobranca(c);
        return finTab==="historico" ? st==="pago" : st!=="pago";
      })
      .sort(function(a,b){
        return (b.vencimento||"")<(a.vencimento||"")?-1:1;  // mais recentes primeiro
      });
    var vazioFin = finTab==="historico" ? "Nenhum pagamento no histórico ainda." : "Nenhuma cobrança em aberto.";
    var cobr;
    if(!ordenadas.length){
      cobr='<div class="lista-vazia">'+vazioFin+'</div>';
    } else {
      cobr=ordenadas.map(function(c){
        var st=statusCobranca(c);
        var dot = st==="pago" ? "green" : (st==="vencido" ? "red" : "amber");
        var seloInf = (c.pagoInformado && st!=="pago") ? '<div class="cobr-inf">'+IC.clock+' Pagamento informado · aguardando confirmação</div>' : '';
        var acao = st==="pago"
          ? '<button class="btn btn-dark btn-pagar" onclick="abrirComprovante(\''+c.id+'\')">Comprovante</button>'
          : '<button class="btn btn-primary btn-pagar" onclick="abrirPagamento(\''+c.id+'\')">'+IC.pix+' Pagar</button>';
        return '<div class="card cobr-card"><div class="cobr-main"><div class="cobr-mes">'+c.label+'</div>'+
          '<div class="cobr-val">'+fmtMoeda(c.valor)+'</div>'+
          '<div class="cobr-det"><span class="cobr-dot '+dot+'"></span>'+detalheCobranca(c,st)+'</div>'+seloInf+'</div>'+
          '<div class="cobr-dir">'+badgeCobranca(st)+acao+'</div></div>';
      }).join("");
    }
    var pix='<div class="card fin-pix"><div class="fin-pix-rot"><span class="cobr-pix-ic">'+IC.pix+'</span> Chave PIX do seu personal</div>'+
      '<div class="fin-pix-val">'+pixPersonal+'</div></div>';

    var bannerVis = finTab==="cobrancas" ? banner : "";
    return '<div class="only-desktop pg-head"><h1>Financeiro</h1></div>'+tabs+bannerVis+cobr+pix;
  }

  /* =========================================================================
     TELA: Perfil (real; trocar senha real)
     ========================================================================= */
  function linhaPerfil(r,v){ return '<div class="perfil-linha"><span class="perfil-rot">'+r+'</span><span class="perfil-val">'+(v||"—")+'</span></div>'; }
  function screenPerfil(){
    var foto = meuFotoUrl
      ? '<div class="perfil-foto"><img class="avatar-img" src="'+meuFotoUrl+'" alt="Minha foto"></div>'
      : '<div class="perfil-foto">'+iniciais(meuNome)+'</div>';
    var acoesFoto = '<div class="perfil-foto-acoes">'+
      '<label class="btn btn-dark perfil-foto-btn">'+(meuFotoUrl?'Trocar foto':'Adicionar foto')+
        '<input type="file" accept="image/*" onchange="enviarFotoAluno(this)" hidden></label>'+
      (meuFotoUrl?'<button class="btn btn-dark" onclick="removerFotoAluno()">Remover</button>':'')+'</div>';
    var dados='<div class="perfil-foto-bloco">'+foto+acoesFoto+'</div>'+
      '<div class="perfil-dados">'+linhaPerfil("Nome",meuNome)+linhaPerfil("E-mail",meuEmail)+linhaPerfil("Telefone",meuTelefone)+linhaPerfil("Personal",nomePersonal)+'</div>';
    var senha='<h3 class="section-title">Trocar senha</h3>'+
      '<form class="perfil-form" onsubmit="trocarSenha(event)"><div class="auth-erro" id="senha-erro" hidden></div><div class="auth-msg" id="senha-msg" hidden></div>'+
      '<div class="field"><label for="nova-senha">Nova senha</label><div class="input-ic"><input id="nova-senha" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"><button type="button" class="input-ic-eye" onclick="toggleSenha(\'nova-senha\')">&#128065;</button></div></div>'+
      '<div class="field"><label for="nova-senha-confirma">Confirmar nova senha</label><input id="nova-senha-confirma" type="password" autocomplete="new-password" placeholder="Repita a nova senha"></div>'+
      '<button type="submit" class="btn btn-primary" id="senha-submit">Salvar nova senha</button></form>';
    var sair='<button class="btn btn-dark block perfil-sair" onclick="sairDaConta()">'+IC.logout+' Sair da conta</button>';
    return '<div class="only-desktop pg-head"><h1>Meu perfil</h1></div>'+dados+senha+sair;
  }
  window.trocarSenha = async function(ev){
    ev.preventDefault();
    var nova=document.getElementById("nova-senha").value, conf=document.getElementById("nova-senha-confirma").value;
    var btn=document.getElementById("senha-submit");
    setErro("senha-erro",""); setErro("senha-msg","");
    if(nova.length<6){ setErro("senha-erro","A nova senha precisa ter pelo menos 6 caracteres."); return; }
    if(nova!==conf){ setErro("senha-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{ var r=await sb.auth.updateUser({password:nova}); if(r.error) throw r.error;
      document.getElementById("nova-senha").value=""; document.getElementById("nova-senha-confirma").value="";
      setErro("senha-msg","Senha alterada com sucesso."); toast("Senha alterada.");
    } catch(err){ console.error(err); setErro("senha-erro",(err&&err.message)||"Não foi possível alterar a senha."); }
    finally{ btn.disabled=false; btn.textContent="Salvar nova senha"; }
  };
  var cropper = null, cropObjectUrl = null;
  // 1) Seleciona o arquivo -> abre o editor de recorte (círculo, zoom, girar).
  window.enviarFotoAluno = function(input){
    var file = input.files && input.files[0];
    if(!file) return;
    if(file.size > 8000000){ toast("Imagem muito grande. Use um arquivo de até 8MB."); input.value=""; return; }
    if(!/^image\//.test(file.type)){ toast("Selecione um arquivo de imagem."); input.value=""; return; }
    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch(e){} }
    cropObjectUrl = URL.createObjectURL(file);
    var html='<div class="crop-modal">'+
      '<div class="modal-tit">Ajustar foto</div>'+
      '<div class="modal-sub">Arraste para posicionar, use o zoom e gire se precisar.</div>'+
      '<div class="crop-area"><img id="crop-img" src="'+cropObjectUrl+'" alt=""></div>'+
      '<div class="crop-ctrls">'+
        '<button class="crop-ic" onclick="cropGirar()" aria-label="Girar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v4h-4"/></svg></button>'+
        '<input id="crop-zoom" class="crop-zoom" type="range" min="0" max="1" step="0.01" value="0" oninput="cropZoom(this.value)">'+
      '</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="cancelarRecorte()">Cancelar</button>'+
        '<button class="btn btn-primary" id="crop-ok" onclick="confirmarRecorteFoto()">Usar foto</button></div></div>';
    abrirModal(html);
    input.value="";
    var img = document.getElementById("crop-img");
    if(cropper){ try{ cropper.destroy(); }catch(e){} cropper=null; }
    cropper = new Cropper(img, {
      aspectRatio: 1, viewMode: 1, dragMode: "move", autoCropArea: 1,
      background: false, movable: true, zoomable: true, guides: true,
      cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false
    });
  };
  window.cropZoom = function(v){ if(cropper) cropper.zoomTo(Number(v)*2.5); };
  window.cropGirar = function(){ if(cropper) cropper.rotate(90); };
  window.cancelarRecorte = function(){
    if(cropper){ try{ cropper.destroy(); }catch(e){} cropper=null; }
    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch(e){} cropObjectUrl=null; }
    document.getElementById("modal-overlay").hidden=true;
  };
  window.confirmarRecorteFoto = function(){
    if(!cropper) return;
    var btn=document.getElementById("crop-ok"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
    var canvas = cropper.getCroppedCanvas({ width:512, height:512, imageSmoothingQuality:"high", fillColor:"#0e141a" });
    canvas.toBlob(function(blob){
      if(!blob){ toast("Não consegui processar a imagem."); if(btn){btn.disabled=false;btn.textContent="Usar foto";} return; }
      uploadFotoBlob(blob);
    }, "image/jpeg", 0.9);
  };
  async function uploadFotoBlob(blob){
    toast("Enviando foto...");
    try{
      var sess = await sb.auth.getSession();
      var uid = sess.data.session && sess.data.session.user && sess.data.session.user.id;
      if(!uid) throw new Error("sem sessão");
      var caminho = uid + "/foto-" + Date.now() + ".jpg";
      var up = await sb.storage.from("fotos-alunos").upload(caminho, blob, { upsert:true, contentType:"image/jpeg" });
      if(up.error) throw up.error;
      var url = sb.storage.from("fotos-alunos").getPublicUrl(caminho).data.publicUrl;
      var r = await sb.rpc("definir_foto_aluno", { p_url: url });
      if(r.error) throw r.error;
      meuFotoUrl = url;
      cancelarRecorte();
      renderShell(); ir("perfil");
      toast("Foto atualizada!");
    }catch(err){ console.error(err); toast("Não consegui enviar a foto. Tente de novo.");
      var b=document.getElementById("crop-ok"); if(b){ b.disabled=false; b.textContent="Usar foto"; } }
  }
  window.removerFotoAluno = async function(){
    try{
      var r = await sb.rpc("definir_foto_aluno", { p_url: null });
      if(r.error) throw r.error;
      meuFotoUrl = null;
      renderShell(); ir("perfil");
      toast("Foto removida.");
    }catch(err){ console.error(err); toast("Não consegui remover a foto."); }
  };

  /* =========================================================================
     Navegação
     ========================================================================= */
  var SCREENS={ inicio:screenInicio, aulas:screenAulas, agenda:screenAgenda, solicitacoes:screenSolic, financeiro:screenFinanceiro, perfil:screenPerfil };
  window.ir = function(id){
    tabAtual=id; document.body.setAttribute("data-tab",id);
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){ return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>'; }).join("");
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){ return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>'; }).join("");
    renderMHeader();
    var c=document.getElementById("content");
    c.innerHTML='<div class="screen screen-'+id+'">'+ (SCREENS[id]?SCREENS[id]():"") +'</div>';
    c.scrollTop=0;
  };
  function renderAll(){ /* compat: entra pela ir() após login */ }

})();
