# frozen_string_literal: true

module VerifyPdfSignature
  COMMON_NAME = 'CN'
  TIME_FORMAT = '%Y%m%d%H%M%S%z'

  SignatureStruct = Struct.new(:messages, :reason, :signing_time, :common_name, :type)
  MessageStruct = Struct.new(:text, :status)

  module_function

  def call(io, trusted_certs)
    Pdfium::Document.open_io(io) do |document|
      signatures = document.signatures.select { |e| e.byte_range.any?(&:positive?) && e.contents.present? }

      next [] if signatures.blank?

      has_unsigned_changes = unsigned_changes?(document, io)

      signatures.map.with_index do |signature, index|
        build_signature(signature, io, trusted_certs,
                        has_unsigned_changes && index == signatures.size - 1)
      end
    end
  end

  def build_signature(signature, io, trusted_certs, has_unsigned_changes)
    pkcs7 = OpenSSL::PKCS7.new(signature.contents)
    verified = verify_contents(pkcs7, signed_data(io, signature.byte_range), trusted_certs)

    SignatureStruct.new(
      messages: build_messages(pkcs7, verified, trusted_certs, has_unsigned_changes),
      reason: signature.reason,
      signing_time: signing_time(pkcs7, signature),
      common_name: common_name(pkcs7),
      type: signature.sub_filter
    )
  rescue OpenSSL::PKCS7::PKCS7Error
    SignatureStruct.new(
      messages: [MessageStruct.new(text: I18n.t('signature_verification_failed'), status: :error)],
      reason: signature.reason,
      signing_time: parse_time(signature.time),
      type: signature.sub_filter
    )
  end

  def build_messages(pkcs7, verified, trusted_certs, has_unsigned_changes)
    messages =
      if verified
        [MessageStruct.new(text: I18n.t('signature_valid'), status: :success),
         certificate_message(pkcs7, trusted_certs)]
      else
        [MessageStruct.new(text: I18n.t('signature_verification_failed'), status: :error)]
      end

    if has_unsigned_changes
      messages << MessageStruct.new(text: I18n.t('contains_unsigned_changes_after_the_last_signature'),
                                    status: :warning)
    end

    messages << MessageStruct.new(text: "Certificate chain: #{certificate_chain(pkcs7).join(' -> ')}")
  end

  def certificate_message(pkcs7, trusted_certs)
    public_key = signer_certificate(pkcs7)&.public_key&.to_der

    if trusted_certs.any? { |e| e.public_key.to_der == public_key }
      MessageStruct.new(text: I18n.t('signed_with_trusted_certificate'), status: :success)
    else
      MessageStruct.new(text: I18n.t('signed_with_external_certificate'), status: :error)
    end
  end

  def verify_contents(pkcs7, signed_data, trusted_certs)
    return false if digest_algorithms(pkcs7).blank?

    store = OpenSSL::X509::Store.new
    store.set_default_paths
    store.purpose = OpenSSL::X509::PURPOSE_SMIME_SIGN
    store.verify_callback = ->(_success, _context) { true }
    trusted_certs.each { |cert| store.add_cert(cert) }

    pkcs7.verify(pkcs7.certificates, store, signed_data,
                 OpenSSL::PKCS7::DETACHED | OpenSSL::PKCS7::BINARY)
  end

  def digest_algorithms(pkcs7)
    OpenSSL::ASN1.decode(pkcs7.to_der).value[1].value[0].value[1].value
  end

  def common_name(pkcs7)
    cert = signer_certificate(pkcs7)

    return if cert.nil?

    cert.subject.to_a.assoc(COMMON_NAME)&.dig(1)
  end

  def signer_certificate(pkcs7)
    info = pkcs7.signers.first

    pkcs7.certificates&.find { |cert| cert.issuer == info.issuer && cert.serial == info.serial }
  end

  def certificate_chain(pkcs7)
    signer = signer_certificate(pkcs7)

    return [] if signer.nil?

    certs = [signer]

    while (issuer = pkcs7.certificates.find { |cert| cert.subject == certs.last.issuer })
      break if certs.include?(issuer)

      certs << issuer
    end

    certs.map { |cert| cert.subject.to_a.assoc(COMMON_NAME)&.dig(1) }
  end

  def signing_time(pkcs7, signature)
    cms_signing_time(pkcs7) || parse_time(signature.time)
  end

  def cms_signing_time(pkcs7)
    pkcs7.signers.first&.signed_time
  rescue StandardError
    nil
  end

  def parse_time(value)
    return if value.blank?

    time = value.delete("'").delete_prefix('D:')
    offset = time[14..].to_s

    Time.strptime("#{time.first(14)}#{offset.start_with?('+', '-') ? offset : '+0000'}", TIME_FORMAT)
  end

  def unsigned_changes?(document, io)
    signed_end = document.signatures.map(&:signed_end).max

    return false if document.trailer_ends.none? { |offset| offset > signed_end }

    io.seek(0)

    Pdfium::Document.open_bytes(io.read(signed_end)) do |signed_document|
      next false unless signed_document.valid_cross_reference_table?

      serialized_document(signed_document) != serialized_document(document)
    end
  end

  def serialized_document(document)
    pages = (0...document.page_count).map do |index|
      page = document.get_page(index)

      [page.rotation, page.objects, page.annotations, page.text]
    end

    [pages, document.bookmarks]
  end

  def signed_data(io, byte_range)
    byte_range.each_slice(2).map do |offset, length|
      io.seek(offset)
      io.read(length)
    end.join
  end
end
