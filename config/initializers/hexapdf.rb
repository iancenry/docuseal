# frozen_string_literal: true

module HexaPDF
  module DigitalSignature
    class Signatures
      private

      def generate_field_name
        index = (@document.acro_form.each_field
                 .map { |field| field.full_field_name.to_s.scan(/\ASignature(\d+)/).first&.first.to_i }
                 .max || 0) + 1
        "Signature#{index}"
      end
    end
  end

  module Encryption
    class SecurityHandler
      def encrypt_string(str, obj)
        return str.dup if str.empty? || obj == document.trailer[:Encrypt] || obj.type == :XRef ||
                          (obj.type == :Sig && obj[:Contents].equal?(str))

        key = object_key(obj.oid, obj.gen, string_algorithm)
        string_algorithm.encrypt(key, str).dup
      end
    end

    module AES
      module ClassMethods
        def unpad(data)
          padding_length = data.getbyte(-1)
          if !padding_length || padding_length > BLOCK_SIZE || padding_length.zero? ||
             data[-padding_length, padding_length].each_byte.any? { |byte| byte != padding_length }
            data
          else
            data[0...-padding_length]
          end
        end
      end
    end
  end

  module Type
    class Page
      # fix NoMethodError (undefined method `color_space' for an instance of HexaPDF::Type::Page)
      def color_space(name)
        GlobalConfiguration.constantize('color_space.map', name).new
      end
    end

    # fix NoMethodError: undefined method `field_value' for #<HexaPDF::Type::AcroForm::Field
    module AcroForm
      class Field
        def field_value
          ''
        end

        def terminal_field?
          kids = self[:Kids]

          # rubocop:disable Rails/Blank
          kids.nil? || kids.empty? || kids.none? { |kid| kid&.key?(:T) }
          # rubocop:enable Rails/Blank
        end
      end

      # fix NoMethodError: undefined method `stream' for an instance of Symbol
      class TextField
        def field_value
          return unless value[:V]
          return self[:V].to_s if self[:V].is_a?(Symbol)

          self[:V].is_a?(String) ? self[:V] : self[:V].stream
        end
      end

      class AppearanceGenerator
        def create_push_button_appearances
          nil
        end
      end
    end

    # comparison of Integer with HexaPDF::PDFArray failed
    class CIDFont < Font
      private

      def widths
        cache(:widths) do
          result = {}
          index = 0
          array = self[:W] || []

          while index < array.size
            entry = array[index]
            value = array[index + 1]

            if value.is_a?(Array) || value.is_a?(HexaPDF::PDFArray)
              value.each_with_index { |width, i| result[entry + i] = width }
              index += 2
            else
              width = array[index + 2]
              entry.upto(value) { |cid| result[cid] = width }
              index += 3
            end
          end

          result
        end
      end
    end
  end

  module CycleSafeInheritedValue
    using HexaPDF::Type::AcroForm::Field::HashRefinement

    def inherited_value(field, name)
      seen = Set.new.compare_by_identity
      seen << field.value

      while field.value[name].nil? && (parent = field[:Parent]) && seen.add?(parent.value)
        field = parent
      end

      field.value[name].nil? ? nil : field[name]
    end
  end

  module CycleSafeEachField
    def each_field(terminal_only: true)
      return to_enum(__method__, terminal_only:) unless block_given?

      seen = Set.new.compare_by_identity

      process_field_array = lambda do |array|
        array.each_with_index do |field, index|
          next if field.nil?

          unless field.respond_to?(:type) && field.type == :XXAcroFormField
            array[index] = field = HexaPDF::Type::AcroForm::Field.wrap(document, field)
          end

          next unless seen.add?(field.value)

          if field.terminal_field?
            yield(field)
          else
            yield(field) unless terminal_only

            process_field_array.call(field[:Kids])
          end
        end
      end

      process_field_array.call(root_fields)

      self
    end
  end

  module CycleSafeFullFieldName
    def full_field_name(seen = Set.new.compare_by_identity)
      return field_name unless seen.add?(value)

      if key?(:Parent)
        [self[:Parent].full_field_name(seen), field_name].compact.join('.')
      else
        field_name
      end
    end
  end
end

HexaPDF::Type::AcroForm::Field.singleton_class.prepend(HexaPDF::CycleSafeInheritedValue)
HexaPDF::Type::AcroForm::Field.prepend(HexaPDF::CycleSafeFullFieldName)
HexaPDF::Type::AcroForm::Form.prepend(HexaPDF::CycleSafeEachField)
